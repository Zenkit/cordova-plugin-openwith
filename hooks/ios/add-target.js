'use strict';

const path = require('path');
const plist = require('plist');

const { PLUGIN_ID, BUNDLE_SUFFIX, PBX_TARGET, PBX_GROUP_KEY } = require('./constants');
const { readFile, writeFile, getPlatformFolder, getXCodeProject, parsePbxProject, getShareExtensionFiles } = require('./helpers');

const replacePreferencesInFile = function(filePath, preferences) {
    return readFile(filePath, 'utf-8').then(content => {
        preferences.forEach(pref => {
            const regexp = new RegExp(pref.key, 'g');
            content = content.replace(regexp, pref.value);
        });
        return writeFile(filePath, content);
    });
};

const getPreferenceValue = function(configXML, name) {
    const value = configXML.match(new RegExp('name="' + name + '" value="(.*?)"', 'i'));
    if (value && value[1]) {
        return value[1];
    } else {
        return null;
    }
};

const getCordovaParameter = function(configXML, constiableName) {
    const arg = process.argv.filter(function(arg) {
        return arg.indexOf(constiableName + '=') == 0;
    });
    if (arg.length >= 1) {
        return arg[0].split('=')[1];
    }
    return getPreferenceValue(configXML, constiableName);
};

const getPreferences = function(context, configXML, projectName) {
    const plistPath = path.join(
        getPlatformFolder(context),
        projectName,
        `${projectName}-Info.plist`
    );
    return readFile(plistPath, 'utf-8')
        .then(data => plist.parse(data))
        .then(plist => {
            const BUNDLE_IDENTIFIER = plist.CFBundleIdentifier + BUNDLE_SUFFIX;
            return [
                {
                    key: '__DISPLAY_NAME__',
                    value: projectName,
                },
                {
                    key: '__BUNDLE_IDENTIFIER__',
                    value: BUNDLE_IDENTIFIER,
                },
                {
                    key: '__GROUP_IDENTIFIER__',
                    value: 'group.' + BUNDLE_IDENTIFIER,
                },
                {
                    key: '__BUNDLE_SHORT_VERSION_STRING__',
                    value: plist.CFBundleShortVersionString,
                },
                {
                    key: '__BUNDLE_VERSION__',
                    value: plist.CFBundleVersion,
                },
                {
                    key: '__URL_SCHEME__',
                    value: getCordovaParameter(configXML, 'IOS_URL_SCHEME'),
                },
                {
                    key: '__UNIFORM_TYPE_IDENTIFIER__',
                    value: getCordovaParameter(configXML, 'IOS_UNIFORM_TYPE_IDENTIFIER') || 'public.data',
                },
            ];
        });
};

module.exports = function(context) {
    console.log('Adding target "' + PLUGIN_ID + '/ShareExtension" to XCode project');

    const configXMLPath = path.join(context.opts.projectRoot, 'config.xml');
    const resolvedConfigXML = readFile(configXMLPath, 'utf-8').then(configXML =>
        configXML.substring(configXML.indexOf('<'))
    );

    const resolvedXCodeProject = getXCodeProject(context);

    const resolvedPbxProject = resolvedXCodeProject.then(project =>
        parsePbxProject(context, project.folder)
    );

    const resolvedExtensionFiles = getShareExtensionFiles(context);

    const resolvedPreferences = Promise.all([resolvedConfigXML, resolvedXCodeProject]).then(
        ([configXML, project]) => getPreferences(context, configXML, project.name)
    );

    const replacedPreferences = Promise.all([resolvedPreferences, resolvedExtensionFiles]).then(
        ([preferences, files]) => {
            const replaced = files.plist
                .concat(files.source)
                .map(file => replacePreferencesInFile(file.path, preferences));

            return Promise.all(replaced);
        }
    );

    const updatedPbxProject = Promise.all([
        resolvedConfigXML,
        resolvedPbxProject,
        resolvedExtensionFiles,
    ]).then(([configXML, pbx, files]) => {
        // Find if the project already contains the target and group
        let target = pbx.project.pbxTargetByName(PBX_TARGET);
        if (target) {
            console.log('    ShareExtension target already exists.');
        } else {
            // Add PBXNativeTarget to the project
            target = pbx.project.addTarget(PBX_TARGET, 'app_extension', PBX_TARGET);

            // Add a new PBXSourcesBuildPhase for our ShareViewController
            // (we can't add it to the existing one because an extension is kind of an extra app)
            pbx.project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', target.uuid);

            // Add a new PBXResourcesBuildPhase for the Resources used by the Share Extension
            // (MainInterface.storyboard)
            pbx.project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', target.uuid);
        }

        // Create a separate PBXGroup for the shareExtensions files, name has to be unique and path must be in quotation marks
        let pbxGroupKey = pbx.project.findPBXGroupKey({ name: PBX_GROUP_KEY });
        if (pbxGroupKey) {
            console.log('    ShareExtension group already exists.');
        } else {
            pbxGroupKey = pbx.project.pbxCreateGroup(PBX_GROUP_KEY, PBX_GROUP_KEY);

            // Add the PbxGroup to cordovas "CustomTemplate"-group
            const customTemplateKey = pbx.project.findPBXGroupKey({ name: 'CustomTemplate' });
            pbx.project.addToPbxGroup(pbxGroupKey, customTemplateKey);
        }

        // Add files which are not part of any build phase (config)
        files.plist.forEach(function(file) {
            pbx.project.addFile(file.name, pbxGroupKey);
        });

        // Add source files to our PbxGroup and our newly created PBXSourcesBuildPhase
        files.source.forEach(function(file) {
            pbx.project.addSourceFile(file.name, { target: target.uuid }, pbxGroupKey);
        });

        //  Add the resource file and include it into the targest PbxResourcesBuildPhase and PbxGroup
        files.resource.forEach(function(file) {
            pbx.project.addResourceFile(file.name, { target: target.uuid }, pbxGroupKey);
        });

        //Add development team and provisioning profile
        const PROVISIONING_PROFILE = getCordovaParameter(configXML, 'SHAREEXT_PROVISIONING_PROFILE');
        const DEVELOPMENT_TEAM = getCordovaParameter(configXML, 'SHAREEXT_DEVELOPMENT_TEAM');
        if (PROVISIONING_PROFILE && DEVELOPMENT_TEAM) {
            console.log(
                'Adding team',
                DEVELOPMENT_TEAM,
                'and provisoning profile',
                PROVISIONING_PROFILE
            );
            const configurations = pbx.project.pbxXCBuildConfigurationSection();
            for (const key in configurations) {
                if (typeof configurations[key].buildSettings !== 'undefined') {
                    const buildSettingsObj = configurations[key].buildSettings;
                    if (typeof buildSettingsObj['PRODUCT_NAME'] !== 'undefined') {
                        const productName = buildSettingsObj['PRODUCT_NAME'];
                        if (productName.indexOf('ShareExt') >= 0) {
                            buildSettingsObj['PROVISIONING_PROFILE'] = PROVISIONING_PROFILE;
                            buildSettingsObj['DEVELOPMENT_TEAM'] = DEVELOPMENT_TEAM;
                            console.log('Added signing identities for extension!');
                        }
                    }
                }
            }
        }

        // Write the modified project back to disc
        // console.log('    Writing the modified project back to disk...');
        return writeFile(pbx.path, pbx.project.writeSync());
    });

    return Promise.all([replacedPreferences, updatedPbxProject]).then(() =>
        console.log('Added ShareExtension to XCode project')
    );
};
