'use strict';

const path = require('path');
const fs = require('fs-extra');
const plist = require('plist');

const { PluginError, getProjectName, getPbxProject } = require('./helpers');
const { PLUGIN_ID, BUNDLE_SUFFIX, PBX_TARGET, PBX_GROUP_KEY } = require('./constants');

const getProjectInfo = async ({ projectDir, projectName }) => {
    const file = path.join(projectDir, projectName, `${projectName}-Info.plist`);
    return plist.parse(await fs.readFile(file, 'utf-8'));
};

const getPluginConfig = async ({ ctx }) => {
    const plugins = await ctx.cordova.projectMetadata.getPlugins(ctx.opts.projectRoot);

    const plugin = plugins.find(plugin => plugin.name === PLUGIN_ID);
    if (!plugin) {
        throw PluginError(`Couldn't find "${PLUGIN_ID}".`);
    }

    return plugin.variables.reduce((acc, { name, value }) => {
        acc[name] = value;
        return acc;
    }, {});
};

const copyExtensionFiles = async ({ projectDir, pluginConfig, projectInfo }) => {
    const srcDir = path.join(__dirname, '../../src/ios/ShareExtension');
    const files = await fs.readdir(srcDir);

    const targetDir = path.join(projectDir, 'ShareExtension');
    await fs.ensureDir(targetDir);

    const bundleIdentifier = projectInfo.CFBundleIdentifier + BUNDLE_SUFFIX;

    const extensionFiles = files.map(async file => {
        const content = await fs.readFile(path.join(srcDir, file), 'utf-8');

        const converted = content
            .replace(/__BUNDLE_IDENTIFIER__/g, bundleIdentifier)
            .replace(/__URL_SCHEME__/g, pluginConfig.IOS_URL_SCHEME)
            .replace(/__BUNDLE_VERSION__/g, projectInfo.CFBundleVersion)
            .replace(/__DISPLAY_NAME__/g, projectInfo.CFBundleDisplayName)
            .replace(/__GROUP_IDENTIFIER__/g, `group.${bundleIdentifier}`)
            .replace(/__UNIFORM_TYPE_IDENTIFIER__/g, pluginConfig.IOS_UNIFORM_TYPE_IDENTIFIER)
            .replace(/__BUNDLE_SHORT_VERSION_STRING__/g, projectInfo.CFBundleShortVersionString);

        await fs.writeFile(path.join(targetDir, file), converted);

        return file;
    });

    console.log('Copied', extensionFiles.length, 'extension files to project');
    return Promise.all(extensionFiles);
};

const getPbxTarget = ({ pbxProject }) => {
    // The target name get's wrapped into quotation marks when it get's added.
    const existing = pbxProject.findTargetKey(`"${PBX_TARGET}"`);
    if (existing) {
        console.log('Using existing extension target', existing);
        const pbxNativeTarget = pbxProject.pbxNativeTargetSection()[existing];
        return { uuid: existing, pbxNativeTarget };
    }

    // Add PBXNativeTarget to the project
    const created = pbxProject.addTarget(PBX_TARGET, 'app_extension', PBX_TARGET);

    // Add a new PBXSourcesBuildPhase for our ShareViewController
    // (we can't add it to the existing one because an extension is kind of an extra app)
    pbxProject.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', created.uuid);

    // Add a new PBXResourcesBuildPhase for the Resources used by the Share Extension
    // (MainInterface.storyboard)
    pbxProject.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', created.uuid);

    console.log('Created extension target', created.uuid);
    return created;
};

// Create a separate PBXGroup for the shareExtensions files, name has to be unique and path must be in quotation marks
const getPbxGroupKey = ({ pbxProject }) => {
    const existing = pbxProject.findPBXGroupKey({ path: PBX_GROUP_KEY });
    if (existing) {
        console.log('Using existing extension group', existing);
        return existing;
    }

    const created = pbxProject.pbxCreateGroup(PBX_GROUP_KEY, PBX_GROUP_KEY);

    // Add the PbxGroup to cordovas "CustomTemplate"-group
    const customTemplateKey = pbxProject.findPBXGroupKey({ name: 'CustomTemplate' });
    pbxProject.addToPbxGroup(created, customTemplateKey);

    console.log('Created extension group', created);
    return created;
};

const updateProvisioning = ({ pbxProject, extensionTarget }) => {
    const projectTarget = pbxProject.getFirstTarget();

    const { firstProject } = pbxProject.getFirstProject();
    var attributes = Object.entries(firstProject.attributes.TargetAttributes[projectTarget.uuid]);
    for (const [key, value] of attributes) {
        pbxProject.addTargetAttribute(key, value, extensionTarget);
    }

    console.log('Copied', attributes.length, 'attributes to extension');

    const configLists = pbxProject.pbxXCConfigurationList();
    const buildConfigs = pbxProject.pbxXCBuildConfigurationSection();

    const projectBuildConfigs = configLists[firstProject.buildConfigurationList].buildConfigurations;
    const extensionConfigList = extensionTarget.pbxNativeTarget.buildConfigurationList;
    const extensionBuildConfigs = configLists[extensionConfigList].buildConfigurations;
    for (const build of extensionBuildConfigs) {
        const buildConfig = buildConfigs[build.value];
        const y = projectBuildConfigs.find(x => x.comment === build.comment);
        const { PRODUCT_BUNDLE_IDENTIFIER } = buildConfigs[y.value].buildSettings;
        buildConfig.buildSettings.PRODUCT_BUNDLE_IDENTIFIER = PRODUCT_BUNDLE_IDENTIFIER + BUNDLE_SUFFIX;
    }

    console.log('Copied', projectBuildConfigs.length, 'build configs to extension');
};

const updateProject = async ({ projectDir, projectName, extensionFiles }) => {
    const pbxProject = await getPbxProject({ projectDir, projectName });

    const groupKey = getPbxGroupKey({ pbxProject });
    const extensionTarget = getPbxTarget({ pbxProject });
    for (const extensionFile of extensionFiles) {
        const ext = path.extname(extensionFile);
        if (ext === '.plist') {
            pbxProject.addFile(extensionFile, groupKey);
        } else if (ext === '.h' || ext === '.m') {
            pbxProject.addSourceFile(extensionFile, { target: extensionTarget.uuid }, groupKey);
        } else {
            pbxProject.addResourceFile(extensionFile, { target: extensionTarget.uuid }, groupKey);
        }
    }

    await updateProvisioning({ pbxProject, extensionTarget });

    const updatedProject = pbxProject.writeSync();
    await fs.writeFile(pbxProject.filepath, updatedProject);

    console.log('Added extension to project');
};

module.exports = async ctx => {
    console.log(`Preparing "${PLUGIN_ID}/ShareExtension"...`);

    const projectDir = path.join(ctx.opts.projectRoot, 'platforms', 'ios');
    const projectName = await getProjectName({ projectDir });

    const pluginConfig = await getPluginConfig({ ctx });
    const projectInfo = await getProjectInfo({ projectDir, projectName });

    const extensionFiles = await copyExtensionFiles({ projectDir, pluginConfig, projectInfo });

    await updateProject({ projectDir, projectName, extensionFiles });

    // eslint-disable-next-line global-require
    var projectFile = require(path.join(projectDir, '/cordova/lib/projectFile.js'));
    projectFile.purgeProjectFileCache(projectDir);
    console.log('Purged project file cache');
};
