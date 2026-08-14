function generate(name) {
    const en = require('../out/i18n/en').default;
    const zhCn = require('../out/i18n/' + name).default;
    const fs = require("fs");

    const result = { ...en, ...zhCn };

    fs.writeFileSync('./i18n/' + name + '.ts',
        `import { __table } from './en';
/*eslint sort-keys: "warn"*/
const table: Partial<typeof __table> = ` +
        JSON.stringify(result, Object.keys(result).sort(), 4) +
        `;

export default table;
`
        );
}

generate('zh-cn');
generate('ko');
generate('ru');
generate('template');
