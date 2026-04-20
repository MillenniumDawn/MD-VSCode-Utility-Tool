"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DivDropdown = exports.numDropDownOpened$ = void 0;
exports.enableDropdowns = enableDropdowns;
const event_1 = require("./event");
const i18n_1 = require("./i18n");
const checkbox_1 = require("./checkbox");
const rxjs_1 = require("rxjs");
const dropdowns = [];
exports.numDropDownOpened$ = new rxjs_1.BehaviorSubject(0);
function enableDropdowns() {
    dropdowns.forEach(s => s.dispose());
    dropdowns.length = 0;
    const selects = document.querySelectorAll('.select-container > select');
    for (let i = 0; i < selects.length; i++) {
        const select = selects[i];
        dropdowns.push(new Dropdown(select));
    }
}
class Dropdown extends event_1.Subscriber {
    select;
    closeDropdown = undefined;
    constructor(select) {
        super();
        this.select = select;
        this.init();
    }
    init() {
        this.addSubscription((0, rxjs_1.fromEvent)(this.select, 'mousedown').subscribe(e => {
            e.preventDefault();
            this.select.focus();
            if (this.closeDropdown) {
                this.closeDropdown();
            }
            else {
                this.showSelectionsForDropdown();
            }
        }));
        this.addSubscription((0, rxjs_1.fromEvent)(this.select, 'keydown').subscribe(e => {
            if (e.code === 'Enter') {
                e.preventDefault();
                if (this.closeDropdown) {
                    this.closeDropdown();
                }
                else {
                    this.showSelectionsForDropdown();
                }
            }
        }));
    }
    showSelectionsForDropdown() {
        this.select.classList.add('dropdown-opened');
        const options = this.select.querySelectorAll('option');
        const optionForDropdownMenu = [];
        options.forEach(option => {
            if (!option.hidden) {
                optionForDropdownMenu.push({
                    text: option.textContent ?? '',
                    value: option.value,
                    selected: option.value === this.select.value,
                });
            }
        });
        const dropdownMenu = new DropdownMenu(optionForDropdownMenu);
        const dropdownMenuSubscriptions = [dropdownMenu];
        dropdownMenuSubscriptions.push((0, event_1.toDisposable)(dropdownMenu.options$.subscribe(options => {
            const selectedOption = options.find(o => o.selected);
            if (selectedOption) {
                this.select.value = selectedOption.value;
                this.select.dispatchEvent(new Event('change'));
            }
            this.closeDropdown?.apply(this);
            setTimeout(() => this.select.focus(), 0);
        })));
        dropdownMenuSubscriptions.push((0, event_1.toDisposable)(dropdownMenu.close$.subscribe(isKey => {
            if (isKey) {
                this.select.focus();
            }
            this.closeDropdown?.apply(this);
        })));
        exports.numDropDownOpened$.next(exports.numDropDownOpened$.value + 1);
        this.closeDropdown = () => {
            this.select.classList.remove('dropdown-opened');
            dropdownMenu.hide();
            dropdownMenuSubscriptions.forEach(d => d.dispose());
            exports.numDropDownOpened$.next(exports.numDropDownOpened$.value - 1);
            this.closeDropdown = undefined;
        };
        dropdownMenu.show(this.select);
    }
}
class DivDropdown extends event_1.Subscriber {
    select;
    multiSelection;
    closeDropdown = undefined;
    selectedValues$ = new rxjs_1.BehaviorSubject([]);
    constructor(select, multiSelection = false) {
        super();
        this.select = select;
        this.multiSelection = multiSelection;
        this.init();
        this.addSubscription(this.selectedValues$.subscribe((value) => {
            const options = this.getOptions(value);
            this.updateSelectedValue(options);
        }));
    }
    selectAll() {
        const options = this.getOptions();
        const values = [];
        options.forEach(option => {
            option.selected = true;
            values.push(option.value);
        });
        this.selectedValues$.next(values);
    }
    init() {
        this.addSubscription((0, rxjs_1.fromEvent)(this.select, 'mousedown').subscribe(e => {
            e.preventDefault();
            this.select.focus();
            if (this.closeDropdown) {
                this.closeDropdown();
            }
            else {
                this.showSelectionsForDropdown();
            }
        }));
        this.addSubscription((0, rxjs_1.fromEvent)(this.select, 'keydown').subscribe(e => {
            if (e.code === 'Enter') {
                e.preventDefault();
                if (this.closeDropdown) {
                    this.closeDropdown();
                }
                else {
                    this.showSelectionsForDropdown();
                }
            }
        }));
        const options = this.getOptions();
        this.updateSelectedValue(options);
    }
    showSelectionsForDropdown() {
        this.select.classList.add('dropdown-opened');
        const dropdownMenu = new DropdownMenu(this.getOptions(), this.multiSelection);
        const dropdownMenuSubscriptions = [dropdownMenu];
        dropdownMenuSubscriptions.push((0, event_1.toDisposable)(dropdownMenu.options$.subscribe(options => {
            this.updateSelectedValue(options);
            this.selectedValues$.next(options.filter(o => o.selected).map(o => o.value));
            if (!this.multiSelection) {
                this.closeDropdown?.apply(this);
                setTimeout(() => this.select.focus(), 0);
            }
        })));
        dropdownMenuSubscriptions.push((0, event_1.toDisposable)(dropdownMenu.close$.subscribe(isKey => {
            if (isKey) {
                this.select.focus();
            }
            this.closeDropdown?.apply(this);
        })));
        exports.numDropDownOpened$.next(exports.numDropDownOpened$.value + 1);
        this.closeDropdown = () => {
            this.select.classList.remove('dropdown-opened');
            dropdownMenu.hide();
            dropdownMenuSubscriptions.forEach(d => d.dispose());
            exports.numDropDownOpened$.next(exports.numDropDownOpened$.value - 1);
            this.closeDropdown = undefined;
        };
        dropdownMenu.show(this.select);
    }
    getOptions(selectedValues) {
        if (selectedValues === undefined) {
            selectedValues = this.selectedValues$.value;
        }
        const options = this.select.querySelectorAll('.option');
        const optionForDropdownMenu = [];
        options.forEach(option => {
            if (!option.hasAttribute('hidden')) {
                const value = option.getAttribute('value');
                optionForDropdownMenu.push({
                    text: option.textContent ?? '',
                    value: value ?? '',
                    selected: value !== null ? selectedValues.includes(value) : false,
                });
            }
        });
        return optionForDropdownMenu;
    }
    updateSelectedValue(options) {
        const selectedOptions = options.filter(o => o.selected);
        const valueSpan = this.select.querySelector('span.value');
        valueSpan.textContent = selectedOptions.length === 0 ? (0, i18n_1.feLocalize)('combobox.noselection', '(No selection)') :
            selectedOptions.length === options.length ? (0, i18n_1.feLocalize)('combobox.all', '(All)') :
                selectedOptions.length > 1 ? (0, i18n_1.feLocalize)('combobox.multiple', '{0} (+{1})', selectedOptions[0].text, selectedOptions.length - 1) :
                    selectedOptions[0].text;
    }
}
exports.DivDropdown = DivDropdown;
class DropdownMenu extends event_1.Subscriber {
    options;
    multiSelection;
    writableOptions$;
    options$;
    writableClose$;
    close$;
    list;
    items = [];
    subscriptionWhenOpen = [];
    constructor(options, multiSelection = false) {
        super();
        this.options = options;
        this.multiSelection = multiSelection;
        this.list = this.createList();
        this.writableOptions$ = new rxjs_1.Subject();
        this.options$ = this.writableOptions$;
        this.writableClose$ = new rxjs_1.Subject();
        this.close$ = this.writableClose$;
        this.addSubscription({
            dispose: () => {
                this.list.remove();
            }
        });
    }
    show(host) {
        this.hide();
        const bbox = host.getBoundingClientRect();
        this.list.style.left = bbox.left + 'px';
        this.list.style.top = bbox.bottom + 'px';
        this.list.style.width = bbox.width + 'px';
        this.registerEventHandlerWhenOpen(host);
        document.body.appendChild(this.list);
        const selectedOptionIndex = this.multiSelection ? 0 : Math.max(0, this.options.findIndex(o => o.selected));
        if (this.items.length > 0) {
            this.items[selectedOptionIndex].focus();
        }
    }
    hide() {
        this.list.parentElement?.removeChild(this.list);
        this.subscriptionWhenOpen.forEach(s => s.unsubscribe());
    }
    createList() {
        const options = this.options;
        const list = document.createElement('ul');
        list.classList.add('select-dropdown');
        const items = this.items;
        for (let i = 0; i < options.length; i++) {
            const option = options[i];
            const item = this.createDropdownItem(option, i, items);
            list.appendChild(item);
        }
        return list;
    }
    createDropdownItem(option, index, items) {
        const item = document.createElement('li');
        item.setAttribute('role', 'option');
        item.tabIndex = -1;
        if (this.multiSelection) {
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = option.selected;
            item.appendChild(checkbox);
            const checkboxItem = new checkbox_1.Checkbox(checkbox, option.text);
            this.addSubscription(checkboxItem);
            (0, rxjs_1.fromEvent)(checkbox, 'change').subscribe(() => {
                option.selected = checkbox.checked;
                this.writableOptions$.next(this.options);
            });
            (0, rxjs_1.fromEvent)(item, 'click').subscribe((e) => {
                if (e.target === item) {
                    checkbox.click();
                }
            });
            (0, rxjs_1.fromEvent)(item, 'keydown').subscribe((e) => {
                if (e.target === item && (e.code === 'Enter' || e.code === 'Space')) {
                    e.preventDefault();
                    checkbox.click();
                }
            });
        }
        else {
            item.textContent = option.text;
            const updateValue = () => {
                this.options.forEach(o => o.selected = false);
                option.selected = true;
                this.writableOptions$.next(this.options);
            };
            (0, rxjs_1.fromEvent)(item, 'click').subscribe(updateValue);
            (0, rxjs_1.fromEvent)(item, 'keydown').subscribe((e) => {
                if (e.code === 'Enter') {
                    e.preventDefault();
                    updateValue();
                }
            });
        }
        (0, rxjs_1.fromEvent)(item, 'mouseenter').subscribe(() => {
            item.focus();
        });
        (0, rxjs_1.fromEvent)(item, 'keydown').subscribe((e) => {
            if (e.code === 'ArrowDown' && index < items.length - 1) {
                e.preventDefault();
                items[index + 1].focus();
            }
            else if (e.code === 'ArrowUp' && index > 0) {
                e.preventDefault();
                items[index - 1].focus();
            }
        });
        items.push(item);
        return item;
    }
    registerEventHandlerWhenOpen(host) {
        const closeDropdown = (escapeKey = false) => {
            this.writableClose$.next(escapeKey);
            this.hide();
        };
        this.subscriptionWhenOpen.push((0, rxjs_1.fromEvent)(window, 'blur').subscribe(() => {
            closeDropdown();
        }));
        this.subscriptionWhenOpen.push((0, rxjs_1.fromEvent)(window, 'focusin').subscribe((e) => {
            if (!(this.list.contains(e.target) || host.contains(e.target))) {
                closeDropdown();
            }
        }));
        this.subscriptionWhenOpen.push((0, rxjs_1.fromEvent)(window, 'mousedown').subscribe((e) => {
            if (!(this.list.contains(e.target) || host.contains(e.target))) {
                closeDropdown();
            }
        }));
        this.subscriptionWhenOpen.push((0, rxjs_1.fromEvent)(window, 'keydown').subscribe((e) => {
            if (e.code === 'Escape') {
                closeDropdown(true);
            }
        }));
    }
}
//# sourceMappingURL=dropdown.js.map