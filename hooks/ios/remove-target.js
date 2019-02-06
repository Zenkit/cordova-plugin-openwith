'use strict';

const { PLUGIN_ID, PBX_TARGET, PBX_GROUP_KEY } = require('./constants');
const { writeFile, getXCodeProject, getShareExtensionFiles, parsePbxProject } = require('./helpers');

module.exports = function(context) {
    console.log('Removing target "' + PLUGIN_ID + '/ShareExtension" from XCode project');


    const resolvedExtensionFiles = getShareExtensionFiles(context);

    const resolvedPbxProject = getXCodeProject(context)
        .then(project => parsePbxProject(context, project.folder));


    return Promise.all([resolvedExtensionFiles, resolvedPbxProject])
        .then(([files, pbx]) => {
            var pbxGroupKey = pbx.project.findPBXGroupKey({ name: PBX_GROUP_KEY });
            if (!pbxGroupKey) {
                return null;
            }

            var customTemplateKey = pbx.project.findPBXGroupKey({ name: 'CustomTemplate' });
            pbx.project.removeFromPbxGroup(pbxGroupKey, customTemplateKey);

            // Remove files which are not part of any build phase (config)
            files.plist.forEach(function(file) {
                pbx.project.removeFile(file.name, pbxGroupKey);
            });

            var target = pbx.project.pbxTargetByName(PBX_TARGET);
            // Remove source files to our PbxGroup and our newly created PBXSourcesBuildPhase
            files.source.forEach(function(file) {
                pbx.project.removeSourceFile(file.name, { target: target.uuid }, pbxGroupKey);
            });

            //  Remove the resource file and include it into the targest PbxResourcesBuildPhase and PbxGroup
            files.resource.forEach(function(file) {
                pbx.project.removeResourceFile(file.name, { target: target.uuid }, pbxGroupKey);
            });

            return writeFile(pbx.projectPath, pbx.project.writeSync());
        })
        .then(() => console.log('Removed ShareExtension from XCode project'));
};
