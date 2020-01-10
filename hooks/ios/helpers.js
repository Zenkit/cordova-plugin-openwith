'use strict';

const path = require('path');
const fs = require('fs-extra');
const xcode = require('xcode');

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

const getPbxProject = async ({ projectDir, projectName }) => {
    const pbxPath = path.join(projectDir, `${projectName}.xcodeproj`, 'project.pbxproj');

    const pbxProject = xcode.project(pbxPath);
    await new Promise((resolve, reject) => {
        pbxProject.parse(error => (error ? reject(error) : resolve()));
    });

    return pbxProject;
};

module.exports = { PluginError, getProjectName, getPbxProject };
