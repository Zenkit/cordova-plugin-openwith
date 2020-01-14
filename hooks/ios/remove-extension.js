'use strict';

const path = require('path');
const fs = require('fs-extra');

const { getProjectName, getProject } = require('./helpers');
const { PLUGIN_ID, PBX_TARGET, PBX_GROUP_KEY } = require('./constants');

const removeExtensionFiles = async ({ projectDir }) => {
    const dir = path.join(projectDir, 'ShareExtension');
    await fs.remove(dir);
};

const updateProject = async ({ projectDir, projectName }) => {
    const project = await getProject({ projectDir, projectName });

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
};

module.exports = async ctx => {
    const projectDir = path.join(ctx.opts.projectRoot, 'platforms', 'ios');
    await removeExtensionFiles({ projectDir });

    const projectName = await getProjectName({ projectDir });
    await updateProject({ projectDir, projectName });

    console.log('Removed ShareExtension from project.');
};
