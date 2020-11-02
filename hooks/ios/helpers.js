'use strict';

const path = require('path');
const fs = require('fs-extra');

const { PLUGIN_ID } = require('./constants');

const PluginError = message => new Error(`"${PLUGIN_ID}": \x1b[1m\x1b[31m${message}\x1b[0m`);

const getProjectName = async ({ projectDir }) => {
    const files = await fs.readdir(projectDir);

    const ext = '.xcodeproj';
    const xcodeproj = files.find(file => path.extname(file) === ext);
    if (!xcodeproj) {
        throw PluginError(`Couldn't find xcode project ar ${projectDir}`);
    }

    return path.basename(xcodeproj, ext);
};

const getProject = ({ projectDir, projectName }) => {
    // eslint-disable-next-line global-require
    var { parse } = require(path.join(projectDir, '/cordova/lib/projectFile.js'));
    const pbxproj = path.join(projectDir, `${projectName}.xcodeproj`, 'project.pbxproj');
    return parse({ root: projectDir, pbxproj });
};

// NOTE: Get the build config the same way the ios compile function does.
// https://github.com/apache/cordova-ios/blob/e92f653/bin/templates/scripts/cordova/lib/build.js#L104-L121
const getBuildConfig = async function ({ ctx }) {
    const { options } = ctx.opts;
    const configPath = options.buildConfig;
    if (!configPath) {
        return options;
    }

    const configExists = await fs.pathExists(configPath);
    if (!configExists) {
        throw new PluginError(`Build config file does not exist: ${configPath}`);
    }

    const { ios } = await fs.readJson(configPath);
    if (!ios) {
        return options;
    }

    const type = options.release ? 'release' : 'debug';
    const config = ios[type];
    if (!config) {
        return options;
    }

    return {
        ...options,
        ...[
            'codeSignIdentity',
            'codeSignResourceRules',
            'provisioningProfile',
            'developmentTeam',
            'packageType',
            'buildFlag',
            'iCloudContainerEnvironment',
            'automaticProvisioning',
        ].reduce((result, key) => {
            var value = options[key] || config[key];
            if (value) {
                result[key] = value;
            }
            return result;
        }, {}),
    };
};

module.exports = { PluginError, getProjectName, getProject, getBuildConfig };
