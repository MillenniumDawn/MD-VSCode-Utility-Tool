"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Checkbox = exports.enableCheckboxes = void 0;
const rxjs_1 = require("rxjs");
const event_1 = require("./event");
const checkboxes = [];
function enableCheckboxes() {
    checkboxes.forEach(s => s.dispose());
    checkboxes.length = 0;
    const inputs = document.querySelectorAll('input[type=checkbox]');
    for (let i = 0; i < inputs.length; i++) {
        const input = inputs[i];
        checkboxes.push(new Checkbox(input));
    }
}
exports.enableCheckboxes = enableCheckboxes;
class Checkbox extends event_1.Subscriber {
    constructor(input, text) {
        super();
        this.input = input;
        this.text = text;
        this.init();
    }
    init() {
        var _a, _b;
        const id = this.input.id;
        let text = (_a = this.text) !== null && _a !== void 0 ? _a : '';
        if (id) {
            const label = document.querySelector('label[for=' + JSON.stringify(id) + ']');
            if (label) {
                label.classList.add('hidden');
                label.tabIndex = -1;
                text = (_b = label.textContent) !== null && _b !== void 0 ? _b : '';
            }
        }
        const checkboxContainerOut = document.createElement('div');
        checkboxContainerOut.classList.add('checkbox-container-out');
        const checkboxContainer = document.createElement('div');
        checkboxContainer.classList.add('checkbox-container');
        checkboxContainerOut.appendChild(checkboxContainer);
        checkboxContainer.tabIndex = 0;
        checkboxContainer.setAttribute('role', 'checkbox');
        checkboxContainer.setAttribute('aria-checked', this.input.checked.toString());
        const checkbox = document.createElement('div');
        checkbox.classList.add('checkbox');
        checkbox.classList.add('codicon');
        checkbox.classList.add('codicon-check');
        checkboxContainer.appendChild(checkbox);
        const label = document.createElement('div');
        label.append(text);
        checkboxContainer.append(label);
        this.input.classList.add('hidden');
        this.input.tabIndex = -1;
        this.input.after(checkboxContainerOut);
        this.addSubscription({
            dispose: () => {
                checkboxContainerOut.remove();
            }
        });
        this.addEventHandlersForCheckBox(checkboxContainer, checkbox);
    }
    addEventHandlersForCheckBox(checkboxContainer, checkbox) {
        const toggleValue = () => {
            this.input.checked = !this.input.checked;
            checkboxContainer.setAttribute('aria-checked', this.input.checked.toString());
            this.input.dispatchEvent(new Event('change'));
        };
        this.addSubscription((0, rxjs_1.fromEvent)(checkboxContainer, 'click').subscribe((e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleValue();
        }));
        this.addSubscription((0, rxjs_1.fromEvent)(checkboxContainer, 'keydown').subscribe((e) => {
            if (e.code === 'Enter' || e.code === 'Space') {
                e.preventDefault();
                toggleValue();
            }
        }));
    }
}
exports.Checkbox = Checkbox;
//# sourceMappingURL=checkbox.js.map