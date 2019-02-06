'use strict';

var fs = require('fs');
var path = require('path');

const PLUGIN_ID = 'cordova-plugin-openwith';

function redError(message) {
    return new Error('"' + PLUGIN_ID + '" \x1b[1m\x1b[31m' + message + '\x1b[0m');
}


// Determine the full path to the ios platform
function iosFolder(context) {
    return context.opts.cordova.project
        ? context.opts.cordova.project.root
        : path.join(context.opts.projectRoot, 'platforms/ios/');
}

// Determine the full path to the app's xcode project file.
function findXCodeproject(context, callback) {
    fs.readdir(iosFolder(context), function(err, data) {
        var projectFolder;
        var projectName;
        // Find the project folder by looking for *.xcodeproj
        if (data && data.length) {
            data.forEach(function(folder) {
                if (folder.match(/\.xcodeproj$/)) {
                    projectFolder = path.join(iosFolder(context), folder);
                    projectName = path.basename(folder, '.xcodeproj');
                }
            });
        }

        if (!projectFolder || !projectName) {
            throw redError('Could not find an .xcodeproj folder in: ' + iosFolder(context));
        }

        if (err) {
            throw redError(err);
        }

        callback(projectFolder, projectName);
    });
}

function parsePbxProject(context, pbxProjectPath) {
    var xcode = context.requireCordovaModule('xcode');
    console.log('    Parsing existing project at location: ' + pbxProjectPath + '...');
    var pbxProject;
    if (context.opts.cordova.project) {
        pbxProject = context.opts.cordova.project.parseProjectFile(context.opts.projectRoot).xcode;
    } else {
        pbxProject = xcode.project(pbxProjectPath);
        pbxProject.parseSync();
    }
    return pbxProject;
}

function forEachShareExtensionFile(context, fn) {
    var shareExtensionFolder = path.join(iosFolder(context), 'ShareExtension');
    fs.readdirSync(shareExtensionFolder).forEach(function(name) {
        // Ignore junk files like .DS_Store
        if (!/^\..*/.test(name)) {
            fn({
                name,
                path: path.join(shareExtensionFolder, name),
                extension: path.extname(name)
            });
        }
    });
}

// Return the list of files in the share extension project, organized by type
function getShareExtensionFiles(context) {
    var files = { source: [], plist: [], resource: [] };
    var FILE_TYPES = { '.h': 'source', '.m': 'source', '.plist': 'plist' };
    forEachShareExtensionFile(context, function(file) {
        var fileType = FILE_TYPES[file.extension] || 'resource';
        files[fileType].push(file);
    });
    return files;
}

console.log('Removing target "' + PLUGIN_ID + '/ShareExtension" to XCode project');

module.exports = function (context) {

    var Q = context.requireCordovaModule('q');
    var deferral = new Q.defer();

    findXCodeproject(context, function(projectFolder) {

        console.log('  - Folder containing your iOS project: ' + iosFolder(context));

        var pbxProjectPath = path.join(projectFolder, 'project.pbxproj');
        var pbxProject = parsePbxProject(context, pbxProjectPath);
        var files = getShareExtensionFiles(context);

        // Find if the project already contains the target and group
        var target = pbxProject.pbxTargetByName('ShareExtension');
        var pbxGroupKey = pbxProject.findPBXGroupKey({ name: 'ShareExtension' });

        // Remove the PbxGroup from cordovas "CustomTemplate"-group
        if (pbxGroupKey) {
            var customTemplateKey = pbxProject.findPBXGroupKey({ name: 'CustomTemplate' });
            pbxProject.removeFromPbxGroup(pbxGroupKey, customTemplateKey);

            // Remove files which are not part of any build phase (config)
            files.plist.forEach(function (file) {
                pbxProject.removeFile(file.name, pbxGroupKey);
            });

            // Remove source files to our PbxGroup and our newly created PBXSourcesBuildPhase
            files.source.forEach(function(file) {
                pbxProject.removeSourceFile(file.name, { target: target.uuid }, pbxGroupKey);
            });

            //  Remove the resource file and include it into the targest PbxResourcesBuildPhase and PbxGroup
            files.resource.forEach(function(file) {
                pbxProject.removeResourceFile(file.name, { target: target.uuid }, pbxGroupKey);
            });
        }

        // Write the modified project back to disc
        // console.log('    Writing the modified project back to disk...');
        fs.writeFileSync(pbxProjectPath, pbxProject.writeSync());
        console.log('Removed ShareExtension from XCode project');

        deferral.resolve();
    });

    return deferral.promise;
};
