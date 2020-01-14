'use strict';

const path = require('path');
const fs = require('fs-extra');
const plist = require('plist');

const { PluginError, getProjectName, getProject } = require('./helpers');
const { PLUGIN_ID, BUNDLE_SUFFIX, PBX_TARGET, PBX_GROUP_KEY } = require('./constants');

const getProjectInfo = async ({ projectDir, projectName }) => {
    const file = path.join(projectDir, projectName, `${projectName}-Info.plist`);
    const info = plist.parse(await fs.readFile(file, 'utf-8'));

    if (info.CFBundleIdentifier.includes('$(PRODUCT_BUNDLE_IDENTIFIER)')) {
        const project = await getProject({ projectDir, projectName });
        const bundleIdentifier = project.xcode.getBuildProperty('PRODUCT_BUNDLE_IDENTIFIER');
        const CFBundleIdentifier = info.CFBundleIdentifier.replace('$(PRODUCT_BUNDLE_IDENTIFIER)', bundleIdentifier);
        return { ...info, CFBundleIdentifier };
    }

    return info;
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

const buildExtensionIdentifier = ({ projectInfo }) => projectInfo.CFBundleIdentifier + BUNDLE_SUFFIX;
const buildGroupIdentifier = ({ projectInfo }) => `group.${projectInfo.CFBundleIdentifier}${BUNDLE_SUFFIX}`;

const copyExtensionFiles = async ({ projectDir, pluginConfig, projectInfo }) => {
    const srcDir = path.join(__dirname, '../../src/ios/ShareExtension');
    const files = await fs.readdir(srcDir);

    const targetDir = path.join(projectDir, 'ShareExtension');
    await fs.ensureDir(targetDir);

    const bundleIdentifier = buildExtensionIdentifier({ projectInfo });
    const groupIdentifier = buildGroupIdentifier({ projectInfo });
    const extensionFiles = files.map(async file => {
        const content = await fs.readFile(path.join(srcDir, file), 'utf-8');

        const converted = content
            .replace(/__GROUP_IDENTIFIER__/g, groupIdentifier)
            .replace(/__BUNDLE_IDENTIFIER__/g, bundleIdentifier)
            .replace(/__URL_SCHEME__/g, pluginConfig.IOS_URL_SCHEME)
            .replace(/__BUNDLE_VERSION__/g, projectInfo.CFBundleVersion)
            .replace(/__DISPLAY_NAME__/g, projectInfo.CFBundleDisplayName)
            .replace(/__UNIFORM_TYPE_IDENTIFIER__/g, pluginConfig.IOS_UNIFORM_TYPE_IDENTIFIER)
            .replace(/__BUNDLE_SHORT_VERSION_STRING__/g, projectInfo.CFBundleShortVersionString);

        await fs.writeFile(path.join(targetDir, file), converted);
    });

    await Promise.all(extensionFiles);

    console.log(`\tCopied ${files.length} extension files to project.`);
    return files;
};

const getPbxTarget = ({ project }) => {
    const uuid = project.xcode.findTargetKey(`"${PBX_TARGET}"`);
    if (uuid) {
        console.log(`\tUsing existing extension target "${uuid}"`);
        // Expose the same structure returned by addTarget
        const pbxNativeTarget = project.xcode.pbxNativeTargetSection()[uuid];
        return { uuid, pbxNativeTarget };
    }

    // Add PBXNativeTarget to the project
    const traget = project.xcode.addTarget(PBX_TARGET, 'app_extension', PBX_TARGET);

    // Add a new PBXSourcesBuildPhase for our ShareViewController
    // (we can't add it to the existing one because an extension is kind of an extra app)
    project.xcode.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', traget.uuid);

    // Add a new PBXResourcesBuildPhase for the Resources used by the Share Extension
    // (MainInterface.storyboard)
    project.xcode.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', traget.uuid);

    console.log(`\tCreated extension target ${traget.uuid}`);
    return traget;
};

// Create a separate PBXGroup for the ShareExtensions files, name has to be unique and path must be in quotation marks
const getPbxGroupKey = ({ project }) => {
    const existingKey = project.xcode.findPBXGroupKey({ path: PBX_GROUP_KEY });
    if (existingKey) {
        console.log(`\tUsing existing extension group "${existingKey}"`);
        return existingKey;
    }

    const createdKey = project.xcode.pbxCreateGroup(PBX_GROUP_KEY, PBX_GROUP_KEY);

    // Add the PbxGroup to cordovas "CustomTemplate"-group
    const customTemplateKey = project.xcode.findPBXGroupKey({ name: 'CustomTemplate' });
    project.xcode.addToPbxGroup(createdKey, customTemplateKey);

    console.log(`\tCreated extension group ${createdKey}.`);
    return createdKey;
};

const addExtensionAttributes = ({ project, extensionTarget }) => {
    const projectTarget = project.xcode.getFirstTarget();

    const { firstProject } = project.xcode.getFirstProject();
    var attributes = Object.entries(firstProject.attributes.TargetAttributes[projectTarget.uuid]);
    for (const [key, value] of attributes) {
        project.xcode.addTargetAttribute(key, value, extensionTarget);
    }
    console.log(`\tAdded ${attributes.length} attributes to extension.`);
};

const setExtensionIdentifier = ({ project, extensionTarget, projectInfo }) => {
    const { buildConfigurationList } = extensionTarget.pbxNativeTarget;
    const { buildConfigurations } = project.xcode.pbxXCConfigurationList()[buildConfigurationList];
    const buildConfigurationSections = project.xcode.pbxXCBuildConfigurationSection();


    const bundleIdentifier = buildExtensionIdentifier({ projectInfo });
    for (const config of buildConfigurations) {
        buildConfigurationSections[config.value].buildSettings.PRODUCT_BUNDLE_IDENTIFIER = bundleIdentifier;
    }
    console.log(`\tSet extendsion identifier "${bundleIdentifier}".`);
};

const updateProject = async ({ projectDir, projectName, extensionFiles, projectInfo }) => {
    const project = await getProject({ projectDir, projectName });

    const groupKey = getPbxGroupKey({ project });
    const extensionTarget = getPbxTarget({ project });
    for (const extensionFile of extensionFiles) {
        const ext = path.extname(extensionFile);
        if (ext === '.plist') {
            project.xcode.addFile(extensionFile, groupKey);
        } else if (ext === '.h' || ext === '.m') {
            project.xcode.addSourceFile(extensionFile, { target: extensionTarget.uuid }, groupKey);
        } else {
            project.xcode.addResourceFile(extensionFile, { target: extensionTarget.uuid }, groupKey);
        }
    }

    await addExtensionAttributes({ project, extensionTarget });
    await setExtensionIdentifier({ project, extensionTarget, projectInfo });

    await project.write();

    console.log('\tAdded extension to project.');
};

const updateProjectEntitlements = async({ projectDir, projectName, projectInfo }) => {
    const entitlementKey = 'com.apple.security.application-groups';
    const groupIdentifier = buildGroupIdentifier({ projectInfo });

    const promises = ['Release', 'Debug'].map(async type => {
        const file = path.join(projectDir, projectName, `Entitlements-${type}.plist`);
        const entitlements = plist.parse(await fs.readFile(file, 'utf-8'));

        const groups = entitlements[entitlementKey] || [];
        if (groups.includes(groupIdentifier)) {
            return;
        }

        entitlements[entitlementKey] = [...groups, groupIdentifier];
        await fs.writeFile(file, plist.build(entitlements));
    });

    await Promise.all(promises);

    console.log(`\tAdded "${groupIdentifier}" to application groups`);
};

module.exports = async ctx => {
    console.log('ShareExtension after prepare hook:');

    const projectDir = path.join(ctx.opts.projectRoot, 'platforms', 'ios');
    const projectName = await getProjectName({ projectDir });

    const pluginConfig = await getPluginConfig({ ctx });
    const projectInfo = await getProjectInfo({ projectDir, projectName });

    const extensionFiles = await copyExtensionFiles({ projectDir, pluginConfig, projectInfo });

    await updateProject({ projectDir, projectName, extensionFiles, projectInfo });

    await updateProjectEntitlements({ projectDir, projectName, projectInfo });
};
