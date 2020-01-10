'use strict';

const path = require('path');
const fs = require('fs-extra');

const { getProjectName, getPbxProject } = require('./helpers');
const { PLUGIN_ID, PBX_TARGET, PBX_GROUP_KEY } = require('./constants');

const removeExtensionFiles = async ({ projectDir }) => {
    const dir = path.join(projectDir, 'ShareExtension');
    await fs.remove(dir);
};

const updateProject = async ({ projectDir, projectName }) => {
    const pbxProject = await getPbxProject({ projectDir, projectName });

    const groupKey = pbxProject.findPBXGroupKey({ path: PBX_GROUP_KEY });
    if (!groupKey) {
        return;
    }

    var customTemplateKey = pbxProject.findPBXGroupKey({ name: 'CustomTemplate' });
    pbxProject.removeFromPbxGroup(groupKey, customTemplateKey);

    const group = pbxProject.getPBXGroupByKey(groupKey);
    const extensionTargetKey = pbxProject.findTargetKey(`"${PBX_TARGET}"`);
    for (const { comment: extensionFile } of group.children) {
        const ext = path.extname(extensionFile);
        if (ext === '.plist') {
            pbxProject.removeFile(extensionFile, groupKey);
        } else if (ext === '.h' || ext === '.m') {
            pbxProject.removeSourceFile(extensionFile, { target: extensionTargetKey }, groupKey);
        } else {
            pbxProject.removeResourceFile(extensionFile, { target: extensionTargetKey }, groupKey);
        }
    }

    const updatedProject = pbxProject.writeSync();
    await fs.writeFile(pbxProject.filepath, updatedProject);
};

module.exports = async ctx => {
    console.log(`Removing "${PLUGIN_ID}/ShareExtension"...`);

    const projectDir = path.join(ctx.opts.projectRoot, 'platforms', 'ios');
    await removeExtensionFiles({ projectDir });

    const projectName = await getProjectName({ projectDir });
    await updateProject({ projectDir, projectName });

    console.log('Removed ShareExtension from project.');
};
