'use strict';

const pkg = require('../../package.json');

const PLUGIN_ID = pkg.name;
const PLUGIN_IDS = [pkg.name, pkg.cordova && pkg.cordova.id].filter(Boolean);
const BUNDLE_SUFFIX = '.shareextension';
const PBX_TARGET = 'ShareExtension';
const PBX_GROUP_KEY = 'ShareExtension';

module.exports = { PLUGIN_ID, PLUGIN_IDS, BUNDLE_SUFFIX, PBX_TARGET, PBX_GROUP_KEY };
