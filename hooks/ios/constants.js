'use strict';

const pkg = require('../../package.json');

const PLUGIN_ID = pkg.name;
const BUNDLE_SUFFIX = '.shareextension';
const PBX_TARGET = 'ShareExtension';
const PBX_GROUP_KEY = 'ShareExtension';

module.exports = { PLUGIN_ID, BUNDLE_SUFFIX, PBX_TARGET, PBX_GROUP_KEY };
