"use strict";
// This file contains constants that may be used in package.json
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebviewType = exports.Commands = exports.ContextName = exports.ViewType = exports.Hoi4FsSchema = exports.ConfigurationKey = void 0;
exports.ConfigurationKey = 'mdHoi4Utilities';
exports.Hoi4FsSchema = 'hoi4installpath';
var ViewType;
(function (ViewType) {
    ViewType.DDS = 'mdhoi4utilities.dds';
    ViewType.TGA = 'mdhoi4utilities.tga';
})(ViewType || (exports.ViewType = ViewType = {}));
var ContextName;
(function (ContextName) {
    ContextName.ShouldHideHoi4Preview = 'shouldHideMdHoi4Preview';
    ContextName.ShouldShowHoi4Preview = 'shouldShowMdHoi4Preview';
    ContextName.Hoi4PreviewType = 'mdHoi4PreviewType';
    ContextName.Hoi4MUInDev = 'mdHoi4MUInDev';
    ContextName.Hoi4MULoaded = 'mdHoi4MULoaded';
})(ContextName || (exports.ContextName = ContextName = {}));
var Commands;
(function (Commands) {
    Commands.Preview = 'mdhoi4utilities.preview';
    Commands.PreviewWorld = 'mdhoi4utilities.previewworld';
    Commands.ScanReferences = 'mdhoi4utilities.scanreferences';
    Commands.SelectModFile = 'mdhoi4utilities.selectmodfile';
    Commands.SelectHoiFolder = 'mdhoi4utilities.selecthoifolder';
    Commands.Test = 'mdhoi4utilities.test';
})(Commands || (exports.Commands = Commands = {}));
var WebviewType;
(function (WebviewType) {
    WebviewType.Preview = 'mdftpreview';
    WebviewType.PreviewWorldMap = 'mdworldmappreview';
})(WebviewType || (exports.WebviewType = WebviewType = {}));
//# sourceMappingURL=constants.js.map