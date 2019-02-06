'use strict';

var fs = require('fs');
var path = require('path');
const PLUGIN_ID = 'cordova-plugin-openwith';

function redError(message) {
    return new Error('"' + PLUGIN_ID + '" \x1b[1m\x1b[31m' + message + '\x1b[0m');
}

console.log('Copying "' + PLUGIN_ID + '/ShareExtension" to ios...');

// http://stackoverflow.com/a/26038979/5930772
function copyFileSync(source, target) {
    var targetFile = target;

    // If target is a directory a new file with the same name will be created
    if (fs.existsSync(target)) {
        if (fs.lstatSync(target).isDirectory()) {
            targetFile = path.join(target, path.basename(source));
        }
    }

    fs.writeFileSync(targetFile, fs.readFileSync(source));
}

function copyFolderRecursiveSync(source, target) {
    var files = [];

    // Check if folder needs to be created or integrated
    var targetFolder = path.join(target, path.basename(source));
    if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder);
    }

    // Copy
    if (fs.lstatSync(source).isDirectory()) {
        files = fs.readdirSync(source);
        files.forEach(function(file) {
            var curSource = path.join(source, file);
            if (fs.lstatSync(curSource).isDirectory()) {
                copyFolderRecursiveSync(curSource, targetFolder);
            } else {
                copyFileSync(curSource, targetFolder);
            }
        });
    }
}

// Determine the full path to the app's xcode project file.
function findXCodeproject(context, callback) {
    var iosFolder = context.opts.cordova.project
        ? context.opts.cordova.project.root
        : path.join(context.opts.projectRoot, 'platforms/ios/');
    fs.readdir(iosFolder, function(err, data) {
        var projectFolder;
        var projectName;
        // Find the project folder by looking for *.xcodeproj
        if (data && data.length) {
            data.forEach(function(folder) {
                if (folder.match(/\.xcodeproj$/)) {
                    projectFolder = path.join(iosFolder, folder);
                    projectName = path.basename(folder, '.xcodeproj');
                }
            });
        }

        if (!projectFolder || !projectName) {
            throw redError('Could not find an .xcodeproj folder in: ' + iosFolder);
        }

        if (err) {
            throw redError(err);
        }

        callback(projectFolder, projectName);
    });
}

module.exports = function(context) {
    var Q = context.requireCordovaModule('q');
    var deferral = new Q.defer();

    findXCodeproject(context, function() {

        var srcFolder = path.join(context.opts.projectRoot, 'plugins', PLUGIN_ID, 'src', 'ios', 'ShareExtension');
        if (!fs.existsSync(srcFolder)) {
            throw redError('Missing extension project folder in ' + srcFolder + '.');
        }

        copyFolderRecursiveSync(srcFolder, path.join(context.opts.projectRoot, 'platforms', 'ios'));
        deferral.resolve();
    });

    return deferral.promise;
};
