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

module.exports = { PluginError, getProjectName, getProject };
