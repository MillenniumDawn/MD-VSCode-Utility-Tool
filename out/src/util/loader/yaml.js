"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YamlLoader = void 0;
const loader_1 = require("./loader");
const yaml_1 = require("../yaml");
class YamlLoader extends loader_1.ContentLoader {
    constructor(file, contentProvider) {
        super(file, contentProvider);
        this.readDependency = false;
    }
    async postLoad(content, dependencies, error, session) {
        if (error || (content === undefined)) {
            throw error;
        }
        return {
            result: (0, yaml_1.parseYaml)(content),
        };
    }
    toString() {
        return `[YamlLoader ${this.file}]`;
    }
}
exports.YamlLoader = YamlLoader;
//# sourceMappingURL=yaml.js.map