'use strict';

const path = require('path');
const fs = require('fs-extra');

const { PLUGIN_ID } = require('./constants');

class PluginError extends Error {
    constructor(message) {
        super(`\x1b[1m\x1b[31m${message}\x1b[0m`);
        this.name = PLUGIN_ID;
    }
}

// NOTE: Use the cordova-ios of the project, it is the one the platform was created and prepared with.
// It also caches the parsed project, so the changes of the platform and the hooks don't overwrite each other.
function requireProjectFile({ ctx }) {
    try {
        return require(require.resolve('cordova-ios/lib/projectFile', { paths: [ctx.opts.projectRoot] }));
    } catch (error) {
        return ctx.requireCordovaModule('cordova-ios/lib/projectFile');
    }
}

async function getXcodeProject({ ctx }) {
    const { parse } = requireProjectFile({ ctx });
    const root = path.join(ctx.opts.projectRoot, 'platforms', 'ios');

    const files = await fs.readdir(root);
    const xcodeproj = files.find(file => path.extname(file) === '.xcodeproj');
    if (!xcodeproj) {
        throw new PluginError(`Couldn't find xcode project at ${root}`);
    }

    const pbxproj = path.join(root, xcodeproj, 'project.pbxproj');
    return parse({ root, pbxproj });
}

// NOTE: Get the build config the same way the ios compile function does.
// https://github.com/apache/cordova-ios/blob/07383c1/lib/build.js#L103-L120
async function getBuildConfig({ ctx }) {
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
}

module.exports = { PluginError, getXcodeProject, getBuildConfig };
