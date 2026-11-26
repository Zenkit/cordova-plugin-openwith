'use strict';

const path = require('path');
const fs = require('fs-extra');

const { getXcodeProject } = require('./helpers');
const { PBX_TARGET, PBX_GROUP_KEY } = require('./constants');

async function removeExtensionFiles({ project }) {
    const dir = path.join(project.projectDir, 'ShareExtension');
    await fs.remove(dir);
}

async function updateProject({ project }) {
    const groupKey = project.xcode.findPBXGroupKey({ path: PBX_GROUP_KEY });
    if (!groupKey) {
        return;
    }

    var customTemplateKey = project.xcode.findPBXGroupKey({ name: 'CustomTemplate' });
    project.xcode.removeFromPbxGroup(groupKey, customTemplateKey);

    const group = project.xcode.getPBXGroupByKey(groupKey);
    const extensionTargetKey = project.xcode.findTargetKey(`"${PBX_TARGET}"`);
    for (const { comment: extensionFile } of group.children) {
        const ext = path.extname(extensionFile);
        if (ext === '.plist') {
            project.xcode.removeFile(extensionFile, groupKey);
        } else if (ext === '.h' || ext === '.m') {
            project.xcode.removeSourceFile(extensionFile, { target: extensionTargetKey }, groupKey);
        } else {
            project.xcode.removeResourceFile(extensionFile, { target: extensionTargetKey }, groupKey);
        }
    }

    await project.write();
}

module.exports = async function (ctx) {
    const project = await getXcodeProject({ ctx });
    await removeExtensionFiles({ project });
    await updateProject({ project });

    console.log('Removed ShareExtension from project.');
};
