'use strict';

const path = require('path');
const fs = require('fs-extra');
const plist = require('plist');

const { PluginError, getXcodeProject, getBuildConfig } = require('./helpers');
const { PLUGIN_IDS, BUNDLE_SUFFIX, PBX_TARGET, PBX_GROUP_KEY } = require('./constants');

const getProjectName = project => path.basename(project.xcode_path);

function unwrapPbx(value) {
    if (typeof value !== 'string') {
        return value;
    }
    return value.replace(/^"(.*)"$/, '$1');
}

function getHostTarget(project) {
    const hostName = getProjectName(project);
    const uuid =
        project.xcode.findTargetKey(`"${hostName}"`) || project.xcode.findTargetKey(hostName);
    if (uuid) {
        return { uuid, pbxNativeTarget: project.xcode.pbxNativeTargetSection()[uuid] };
    }

    const section = project.xcode.pbxNativeTargetSection();
    for (const [key, target] of Object.entries(section)) {
        if (key.endsWith('_comment') || !target || !target.name) {
            continue;
        }
        const name = unwrapPbx(target.name);
        if (name !== PBX_TARGET) {
            return { uuid: key, pbxNativeTarget: target };
        }
    }

    return project.xcode.getFirstTarget();
}

function getBuildProperty(project, property, build) {
    const projectName = getProjectName(project);
    return unwrapPbx(project.xcode.getBuildProperty(property, build, projectName));
}

const buildPropertiesRegExp = /\$[({](\w+)[)}]/g;
function replaceBuildProperties(string, project) {
    if (typeof string !== 'string') {
        return string;
    }
    return string.replace(buildPropertiesRegExp, (match, property) => {
        const value = getBuildProperty(project, property);
        return value === undefined ? match : value;
    });
}

async function getProjectInfo({ project }) {
    const projectName = getProjectName(project);
    const file = path.join(project.xcode_path, `${projectName}-Info.plist`);
    let info = {};
    if (await fs.pathExists(file)) {
        info = plist.parse(await fs.readFile(file, 'utf-8'));
    }

    let CFBundleIdentifier = replaceBuildProperties(info.CFBundleIdentifier, project);
    if (!CFBundleIdentifier && typeof project.getPackageName === 'function') {
        CFBundleIdentifier = unwrapPbx(project.getPackageName());
    }
    if (!CFBundleIdentifier) {
        CFBundleIdentifier = getBuildProperty(project, 'PRODUCT_BUNDLE_IDENTIFIER');
    }

    const CFBundleDisplayName =
        info.CFBundleDisplayName ||
        getBuildProperty(project, 'INFOPLIST_KEY_CFBundleDisplayName') ||
        getBuildProperty(project, 'PRODUCT_NAME') ||
        projectName;

    const CFBundleVersion =
        info.CFBundleVersion || getBuildProperty(project, 'CURRENT_PROJECT_VERSION') || '1';

    const CFBundleShortVersionString =
        info.CFBundleShortVersionString ||
        getBuildProperty(project, 'MARKETING_VERSION') ||
        '1.0.0';

    if (!CFBundleIdentifier) {
        throw new PluginError('Could not determine the host CFBundleIdentifier.');
    }

    // NOTE: The values are used in the extension, so build properties of the host have to be resolved
    // (e.g. cordova-ios 8 sets INFOPLIST_KEY_CFBundleDisplayName to $(PRODUCT_NAME)).
    const resolve = value => unwrapPbx(replaceBuildProperties(unwrapPbx(String(value)), project));
    return {
        ...info,
        CFBundleIdentifier: resolve(CFBundleIdentifier),
        CFBundleDisplayName: resolve(CFBundleDisplayName),
        CFBundleVersion: resolve(CFBundleVersion),
        CFBundleShortVersionString: resolve(CFBundleShortVersionString),
    };
}

async function getPluginConfig({ ctx }) {
    const plugins = await ctx.cordova.projectMetadata.getPlugins(ctx.opts.projectRoot);

    const plugin = plugins.find(plugin => PLUGIN_IDS.includes(plugin.name));
    if (!plugin) {
        throw new PluginError(`Couldn't find "${PLUGIN_IDS.join('" or "')}".`);
    }

    // NOTE: Same defaults as the preferences in the plugin.xml
    const config = { IOS_URL_SCHEME: 'openwith', IOS_UNIFORM_TYPE_IDENTIFIER: 'public.data' };
    for (const { name, value } of plugin.variables || []) {
        config[name] = value;
    }

    return config;
}

const EXTENSION_DIRECTORY = 'ShareExtension';
const buildExtensionIdentifier = ({ projectInfo }) => projectInfo.CFBundleIdentifier + BUNDLE_SUFFIX;
const buildGroupIdentifier = ({ projectInfo }) => `group.${projectInfo.CFBundleIdentifier}${BUNDLE_SUFFIX}`;
async function copyExtensionFiles({ project, pluginConfig, projectInfo }) {
    const srcDir = path.join(__dirname, '../../src/ios', EXTENSION_DIRECTORY);
    const files = await fs.readdir(srcDir);

    const targetDir = path.join(project.projectDir, EXTENSION_DIRECTORY);
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
}

function getPbxTarget({ project }) {
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
}

// Create a separate PBXGroup for the ShareExtensions files, name has to be unique and path must be in quotation marks
function getPbxGroupKey({ project }) {
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
}

function addExtensionAttributes({ project, extensionTarget }) {
    const projectTarget = getHostTarget(project);

    const { firstProject } = project.xcode.getFirstProject();
    const targetAttributes = (firstProject.attributes && firstProject.attributes.TargetAttributes) || {};
    const attrs = targetAttributes[projectTarget.uuid] || {};
    const attributes = Object.entries(attrs);
    for (const [key, value] of attributes) {
        project.xcode.addTargetAttribute(key, value, extensionTarget);
    }
    console.log(`\tAdded ${attributes.length} attributes to extension.`);
}

function getCodeSignEntitlements({ extensionFiles }) {
    const file = extensionFiles.find(file => file.endsWith('-Entitlements.plist'));
    if (file) {
        return path.join(EXTENSION_DIRECTORY, file);
    }

    throw new PluginError('Missing code sign entitlements file for share extension.');
}

function updateExtensionBuildProperties({ project, extensionTarget, projectInfo, buildConfig, extensionFiles }) {
    const extensionTargetName = extensionTarget.pbxNativeTarget.name;
    function updateBuildProperty(property, value) {
        if (value) {
            // NOTE: If a value contains characters that aren't allowed unquoted (e.g. whitespaces or commas)
            // and isn't already wrapped, wrap it with "" otherwise the project file can't be parsed anymore.
            const normalized =
                typeof value === 'string' && !/^".*"$/.test(value) && !/^[\w./]+$/.test(value) ? `"${value}"` : value;
            project.xcode.updateBuildProperty(property, normalized, null, extensionTargetName);
            console.log('\tSet build property', property, 'to', normalized);
        }
    }

    const bundleIdentifier = buildExtensionIdentifier({ projectInfo });
    updateBuildProperty('PRODUCT_BUNDLE_IDENTIFIER', bundleIdentifier);

    const codeSignEntitlements = getCodeSignEntitlements({ extensionFiles });
    updateBuildProperty('CODE_SIGN_ENTITLEMENTS', codeSignEntitlements);

    const build = buildConfig.release ? 'Release' : 'Debug';
    const buildPropertiesToCopy = ['IPHONEOS_DEPLOYMENT_TARGET', 'TARGETED_DEVICE_FAMILY'];
    for (const property of buildPropertiesToCopy) {
        const value = getBuildProperty(project, property, build);
        updateBuildProperty(property, value);
    }

    // NOTE: Set build properties from build config
    // https://github.com/apache/cordova-ios/blob/e92f653/bin/templates/scripts/cordova/lib/build.js#L163-L175
    const buildPropertyToBuildConfigKeyMap = {
        CODE_SIGN_IDENTITY: 'codeSignIdentity',
        // NOTE: This is set in the build-extras.xcconfig but doesn't work here.
        // 'CODE_SIGN_IDENTITY[sdk=iphoneos*]': 'codeSignIdentity',
        CODE_SIGN_RESOURCE_RULES_PATH: 'codeSignResourceRules',
        PROVISIONING_PROFILE: 'provisioningProfile',
        DEVELOPMENT_TEAM: 'developmentTeam',
    };

    for (const [property, key] of Object.entries(buildPropertyToBuildConfigKeyMap)) {
        updateBuildProperty(property, buildConfig[key]);
    }
}

function updateCodeSignStyle({ project, extensionTarget, codeSignStyle }) {
    const extensionTargetName = extensionTarget.pbxNativeTarget.name;
    project.xcode.updateBuildProperty('CODE_SIGN_STYLE', codeSignStyle, null, extensionTargetName);
    project.xcode.addTargetAttribute('ProvisioningStyle', codeSignStyle, extensionTarget);
    console.log('\tSet code signing style to', codeSignStyle);
}

async function updateProject({ project, extensionFiles, projectInfo, buildConfig }) {
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
    await updateExtensionBuildProperties({ project, extensionTarget, projectInfo, buildConfig, extensionFiles });

    // NOTE: Update code signing style
    // https://github.com/apache/cordova-ios/blob/e92f653/bin/templates/scripts/cordova/lib/build.js#L188-L194
    if (buildConfig.provisioningProfile) {
        await updateCodeSignStyle({ project, extensionTarget, codeSignStyle: 'Manual' });
    } else if (buildConfig.automaticProvisioning) {
        await updateCodeSignStyle({ project, extensionTarget, codeSignStyle: 'Automatic' });
    }

    await project.write();

    console.log('\tAdded extension to project.');
}

const updateProjectEntitlements = async ({ project, projectInfo }) => {
    const entitlementKey = 'com.apple.security.application-groups';
    const groupIdentifier = buildGroupIdentifier({ projectInfo });

    const promises = ['Release', 'Debug'].map(async type => {
        const file = path.join(project.xcode_path, `Entitlements-${type}.plist`);
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

    const project = await getXcodeProject({ ctx });
    const buildConfig = await getBuildConfig({ ctx });
    const pluginConfig = await getPluginConfig({ ctx });
    const projectInfo = await getProjectInfo({ project });

    const extensionFiles = await copyExtensionFiles({ project, pluginConfig, projectInfo });

    await updateProject({ project, extensionFiles, projectInfo, buildConfig });
    await updateProjectEntitlements({ project, projectInfo });
};
