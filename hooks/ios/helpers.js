'use strict';

const fs = require('fs');
const path = require('path');
const xcode = require('xcode');

const { PLUGIN_ID } = require('./constants');

// Super simple promisify function
const pify = fn => (...args) =>
    new Promise((resolve, reject) => {
        fn(...args, (err, result) => (err ? reject(err) : resolve(result)));
    });

const readdir = pify(fs.readdir);
const readFile = pify(fs.readFile);
const writeFile = pify(fs.writeFile);

const PluginError = message => new Error(`"${PLUGIN_ID}": \x1b[1m\x1b[31m${message}\x1b[0m`);

// Determine the full path to the ios platform
const getPlatformFolder = function(context) {
    return context.opts.cordova.project
        ? context.opts.cordova.project.root
        : path.join(context.opts.projectRoot, 'platforms/ios/');
};

// Determine the full path to the app's xcode project file.
const xcodeprojExt = '.xcodeproj';
const getXCodeProject = function(context) {
    const rootFolder = getPlatformFolder(context);
    return readdir(rootFolder).then(files => {
        const xcodeproj = files.find(file => path.extname(file) === xcodeprojExt);
        if (!xcodeproj) {
            throw PluginError(`Could not find "${xcodeprojExt}" folder in "${rootFolder}"`);
        }

        const folder = path.join(rootFolder, xcodeproj);
        const name = path.basename(xcodeproj, xcodeprojExt);
        return { folder, name };
    });
};

// Return the list of files in the share extension project, organized by type
const FILE_TYPES = { '.h': 'source', '.m': 'source', '.plist': 'plist' };
const getShareExtensionFiles = function(context) {
    const extensionFolder = path.join(getPlatformFolder(context), 'ShareExtension');
    return readdir(extensionFolder)
        .then(files =>
            files
                .filter(name => !/^\..*/.test(name))
                .map(name => ({
                    name,
                    path: path.join(extensionFolder, name),
                    extension: path.extname(name),
                }))
        )
        .then(files =>
            files.reduce(
                (map, file) => {
                    const type = FILE_TYPES[file.extension] || 'resource';
                    map[type].push(file);
                    return map;
                },
                { source: [], plist: [], resource: [] }
            )
        );
};

const parsePbxProject = function(context, projectFolder) {
    const project = context.opts.cordova.project;
    if (project) {
        const parsedProject = project.parseProjectFile(context.opts.projectRoot);
        return parsedProject.xcode;
    }

    const pbxProjectPath = path.join(projectFolder, 'project.pbxproj');
    const pbxProject = xcode.project(pbxProjectPath);
    pbxProject.parseSync();
    return { project: pbxProject, path: pbxProjectPath };
};

module.exports = {
    pify,
    readdir,
    readFile,
    writeFile,
    PluginError,
    getPlatformFolder,
    getXCodeProject,
    getShareExtensionFiles,
    parsePbxProject,
};
