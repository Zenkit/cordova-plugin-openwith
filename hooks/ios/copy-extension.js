'use strict';

const fs = require('fs');
const path = require('path');

const { PLUGIN_ID } = require('./constants');
const { pify, readdir, readFile, writeFile, PluginError } = require('./helpers');


const mkdir = pify(fs.mkdir);
const stat = pify(fs.stat);
const makeDir = dir => {
    const make = pth => mkdir(pth)
        .then(() => pth)
        .catch(error => {
            if (error.code === 'ENOENT') {
                if (error.message.includes('null bytes') || path.dirname(pth) === pth) {
                    throw error;
                }

                return make(path.dirname(pth)).then(() => make(pth));
            }

            return stat(pth)
                .then(stats => (stats.isDirectory() ? pth : Promise.reject(error)))
                .catch(() => {
                    throw error;
                });
        });

    return make(dir);
};

const copyFile = (from, to) => readFile(from).then(buffer => writeFile(to, buffer));
const copyExtensionFiles = function({ files, targetFolder, srcFolder }) {
    return makeDir(targetFolder)
        .then(() => Promise.all(files.map(file => copyFile(path.join(srcFolder, file), path.join(targetFolder, file)))))
        .then(() => targetFolder);
};

// Copy the extension folder
// Right now it has a flat structure, so we can just do readdir(src)
module.exports = function(context) {
    console.log('Copying "' + PLUGIN_ID + '/ShareExtension" to ios...');

    const targetFolder = path.join(context.opts.projectRoot, 'platforms', 'ios', 'ShareExtension');
    const srcFolder = path.join(context.opts.projectRoot, 'plugins', PLUGIN_ID, 'src', 'ios', 'ShareExtension');

    return readdir(srcFolder)
        .catch(() => {
            throw PluginError(`Missing extension project folder in ${srcFolder}.`);
        })
        .then(files => copyExtensionFiles({ files, targetFolder, srcFolder }))
        .then(folder => console.log(`Copied extension to ${folder}.`));
};
