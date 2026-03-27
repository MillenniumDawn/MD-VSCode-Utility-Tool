/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./node_modules/rxjs/_esm5/internal/InnerSubscriber.js":
/*!*************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/InnerSubscriber.js ***!
  \*************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   InnerSubscriber: () => (/* binding */ InnerSubscriber)
/* harmony export */ });
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! tslib */ "./node_modules/rxjs/node_modules/tslib/tslib.es6.js");
/* harmony import */ var _Subscriber__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./Subscriber */ "./node_modules/rxjs/_esm5/internal/Subscriber.js");
/** PURE_IMPORTS_START tslib,_Subscriber PURE_IMPORTS_END */


var InnerSubscriber = /*@__PURE__*/ (function (_super) {
    tslib__WEBPACK_IMPORTED_MODULE_0__.__extends(InnerSubscriber, _super);
    function InnerSubscriber(parent, outerValue, outerIndex) {
        var _this = _super.call(this) || this;
        _this.parent = parent;
        _this.outerValue = outerValue;
        _this.outerIndex = outerIndex;
        _this.index = 0;
        return _this;
    }
    InnerSubscriber.prototype._next = function (value) {
        this.parent.notifyNext(this.outerValue, value, this.outerIndex, this.index++, this);
    };
    InnerSubscriber.prototype._error = function (error) {
        this.parent.notifyError(error, this);
        this.unsubscribe();
    };
    InnerSubscriber.prototype._complete = function () {
        this.parent.notifyComplete(this);
        this.unsubscribe();
    };
    return InnerSubscriber;
}(_Subscriber__WEBPACK_IMPORTED_MODULE_1__.Subscriber));

//# sourceMappingURL=InnerSubscriber.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/OuterSubscriber.js":
/*!*************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/OuterSubscriber.js ***!
  \*************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   OuterSubscriber: () => (/* binding */ OuterSubscriber)
/* harmony export */ });
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! tslib */ "./node_modules/rxjs/node_modules/tslib/tslib.es6.js");
/* harmony import */ var _Subscriber__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./Subscriber */ "./node_modules/rxjs/_esm5/internal/Subscriber.js");
/** PURE_IMPORTS_START tslib,_Subscriber PURE_IMPORTS_END */


var OuterSubscriber = /*@__PURE__*/ (function (_super) {
    tslib__WEBPACK_IMPORTED_MODULE_0__.__extends(OuterSubscriber, _super);
    function OuterSubscriber() {
        return _super !== null && _super.apply(this, arguments) || this;
    }
    OuterSubscriber.prototype.notifyNext = function (outerValue, innerValue, outerIndex, innerIndex, innerSub) {
        this.destination.next(innerValue);
    };
    OuterSubscriber.prototype.notifyError = function (error, innerSub) {
        this.destination.error(error);
    };
    OuterSubscriber.prototype.notifyComplete = function (innerSub) {
        this.destination.complete();
    };
    return OuterSubscriber;
}(_Subscriber__WEBPACK_IMPORTED_MODULE_1__.Subscriber));

//# sourceMappingURL=OuterSubscriber.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/observable/combineLatest.js":
/*!**********************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/observable/combineLatest.js ***!
  \**********************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   CombineLatestOperator: () => (/* binding */ CombineLatestOperator),
/* harmony export */   CombineLatestSubscriber: () => (/* binding */ CombineLatestSubscriber),
/* harmony export */   combineLatest: () => (/* binding */ combineLatest)
/* harmony export */ });
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! tslib */ "./node_modules/rxjs/node_modules/tslib/tslib.es6.js");
/* harmony import */ var _util_isScheduler__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../util/isScheduler */ "./node_modules/rxjs/_esm5/internal/util/isScheduler.js");
/* harmony import */ var _util_isArray__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../util/isArray */ "./node_modules/rxjs/_esm5/internal/util/isArray.js");
/* harmony import */ var _OuterSubscriber__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ../OuterSubscriber */ "./node_modules/rxjs/_esm5/internal/OuterSubscriber.js");
/* harmony import */ var _util_subscribeToResult__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../util/subscribeToResult */ "./node_modules/rxjs/_esm5/internal/util/subscribeToResult.js");
/* harmony import */ var _fromArray__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./fromArray */ "./node_modules/rxjs/_esm5/internal/observable/fromArray.js");
/** PURE_IMPORTS_START tslib,_util_isScheduler,_util_isArray,_OuterSubscriber,_util_subscribeToResult,_fromArray PURE_IMPORTS_END */






var NONE = {};
function combineLatest() {
    var observables = [];
    for (var _i = 0; _i < arguments.length; _i++) {
        observables[_i] = arguments[_i];
    }
    var resultSelector = undefined;
    var scheduler = undefined;
    if ((0,_util_isScheduler__WEBPACK_IMPORTED_MODULE_0__.isScheduler)(observables[observables.length - 1])) {
        scheduler = observables.pop();
    }
    if (typeof observables[observables.length - 1] === 'function') {
        resultSelector = observables.pop();
    }
    if (observables.length === 1 && (0,_util_isArray__WEBPACK_IMPORTED_MODULE_1__.isArray)(observables[0])) {
        observables = observables[0];
    }
    return (0,_fromArray__WEBPACK_IMPORTED_MODULE_2__.fromArray)(observables, scheduler).lift(new CombineLatestOperator(resultSelector));
}
var CombineLatestOperator = /*@__PURE__*/ (function () {
    function CombineLatestOperator(resultSelector) {
        this.resultSelector = resultSelector;
    }
    CombineLatestOperator.prototype.call = function (subscriber, source) {
        return source.subscribe(new CombineLatestSubscriber(subscriber, this.resultSelector));
    };
    return CombineLatestOperator;
}());

var CombineLatestSubscriber = /*@__PURE__*/ (function (_super) {
    tslib__WEBPACK_IMPORTED_MODULE_3__.__extends(CombineLatestSubscriber, _super);
    function CombineLatestSubscriber(destination, resultSelector) {
        var _this = _super.call(this, destination) || this;
        _this.resultSelector = resultSelector;
        _this.active = 0;
        _this.values = [];
        _this.observables = [];
        return _this;
    }
    CombineLatestSubscriber.prototype._next = function (observable) {
        this.values.push(NONE);
        this.observables.push(observable);
    };
    CombineLatestSubscriber.prototype._complete = function () {
        var observables = this.observables;
        var len = observables.length;
        if (len === 0) {
            this.destination.complete();
        }
        else {
            this.active = len;
            this.toRespond = len;
            for (var i = 0; i < len; i++) {
                var observable = observables[i];
                this.add((0,_util_subscribeToResult__WEBPACK_IMPORTED_MODULE_4__.subscribeToResult)(this, observable, undefined, i));
            }
        }
    };
    CombineLatestSubscriber.prototype.notifyComplete = function (unused) {
        if ((this.active -= 1) === 0) {
            this.destination.complete();
        }
    };
    CombineLatestSubscriber.prototype.notifyNext = function (_outerValue, innerValue, outerIndex) {
        var values = this.values;
        var oldVal = values[outerIndex];
        var toRespond = !this.toRespond
            ? 0
            : oldVal === NONE ? --this.toRespond : this.toRespond;
        values[outerIndex] = innerValue;
        if (toRespond === 0) {
            if (this.resultSelector) {
                this._tryResultSelector(values);
            }
            else {
                this.destination.next(values.slice());
            }
        }
    };
    CombineLatestSubscriber.prototype._tryResultSelector = function (values) {
        var result;
        try {
            result = this.resultSelector.apply(this, values);
        }
        catch (err) {
            this.destination.error(err);
            return;
        }
        this.destination.next(result);
    };
    return CombineLatestSubscriber;
}(_OuterSubscriber__WEBPACK_IMPORTED_MODULE_5__.OuterSubscriber));

//# sourceMappingURL=combineLatest.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/observable/fromArray.js":
/*!******************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/observable/fromArray.js ***!
  \******************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   fromArray: () => (/* binding */ fromArray)
/* harmony export */ });
/* harmony import */ var _Observable__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../Observable */ "./node_modules/rxjs/_esm5/internal/Observable.js");
/* harmony import */ var _util_subscribeToArray__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../util/subscribeToArray */ "./node_modules/rxjs/_esm5/internal/util/subscribeToArray.js");
/* harmony import */ var _scheduled_scheduleArray__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../scheduled/scheduleArray */ "./node_modules/rxjs/_esm5/internal/scheduled/scheduleArray.js");
/** PURE_IMPORTS_START _Observable,_util_subscribeToArray,_scheduled_scheduleArray PURE_IMPORTS_END */



function fromArray(input, scheduler) {
    if (!scheduler) {
        return new _Observable__WEBPACK_IMPORTED_MODULE_0__.Observable((0,_util_subscribeToArray__WEBPACK_IMPORTED_MODULE_1__.subscribeToArray)(input));
    }
    else {
        return (0,_scheduled_scheduleArray__WEBPACK_IMPORTED_MODULE_2__.scheduleArray)(input, scheduler);
    }
}
//# sourceMappingURL=fromArray.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/operators/distinctUntilChanged.js":
/*!****************************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/operators/distinctUntilChanged.js ***!
  \****************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   distinctUntilChanged: () => (/* binding */ distinctUntilChanged)
/* harmony export */ });
/* harmony import */ var tslib__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! tslib */ "./node_modules/rxjs/node_modules/tslib/tslib.es6.js");
/* harmony import */ var _Subscriber__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../Subscriber */ "./node_modules/rxjs/_esm5/internal/Subscriber.js");
/** PURE_IMPORTS_START tslib,_Subscriber PURE_IMPORTS_END */


function distinctUntilChanged(compare, keySelector) {
    return function (source) { return source.lift(new DistinctUntilChangedOperator(compare, keySelector)); };
}
var DistinctUntilChangedOperator = /*@__PURE__*/ (function () {
    function DistinctUntilChangedOperator(compare, keySelector) {
        this.compare = compare;
        this.keySelector = keySelector;
    }
    DistinctUntilChangedOperator.prototype.call = function (subscriber, source) {
        return source.subscribe(new DistinctUntilChangedSubscriber(subscriber, this.compare, this.keySelector));
    };
    return DistinctUntilChangedOperator;
}());
var DistinctUntilChangedSubscriber = /*@__PURE__*/ (function (_super) {
    tslib__WEBPACK_IMPORTED_MODULE_0__.__extends(DistinctUntilChangedSubscriber, _super);
    function DistinctUntilChangedSubscriber(destination, compare, keySelector) {
        var _this = _super.call(this, destination) || this;
        _this.keySelector = keySelector;
        _this.hasKey = false;
        if (typeof compare === 'function') {
            _this.compare = compare;
        }
        return _this;
    }
    DistinctUntilChangedSubscriber.prototype.compare = function (x, y) {
        return x === y;
    };
    DistinctUntilChangedSubscriber.prototype._next = function (value) {
        var key;
        try {
            var keySelector = this.keySelector;
            key = keySelector ? keySelector(value) : value;
        }
        catch (err) {
            return this.destination.error(err);
        }
        var result = false;
        if (this.hasKey) {
            try {
                var compare = this.compare;
                result = compare(this.key, key);
            }
            catch (err) {
                return this.destination.error(err);
            }
        }
        else {
            this.hasKey = true;
        }
        if (!result) {
            this.key = key;
            this.destination.next(value);
        }
    };
    return DistinctUntilChangedSubscriber;
}(_Subscriber__WEBPACK_IMPORTED_MODULE_1__.Subscriber));
//# sourceMappingURL=distinctUntilChanged.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/scheduled/scheduleArray.js":
/*!*********************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/scheduled/scheduleArray.js ***!
  \*********************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   scheduleArray: () => (/* binding */ scheduleArray)
/* harmony export */ });
/* harmony import */ var _Observable__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../Observable */ "./node_modules/rxjs/_esm5/internal/Observable.js");
/* harmony import */ var _Subscription__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../Subscription */ "./node_modules/rxjs/_esm5/internal/Subscription.js");
/** PURE_IMPORTS_START _Observable,_Subscription PURE_IMPORTS_END */


function scheduleArray(input, scheduler) {
    return new _Observable__WEBPACK_IMPORTED_MODULE_0__.Observable(function (subscriber) {
        var sub = new _Subscription__WEBPACK_IMPORTED_MODULE_1__.Subscription();
        var i = 0;
        sub.add(scheduler.schedule(function () {
            if (i === input.length) {
                subscriber.complete();
                return;
            }
            subscriber.next(input[i++]);
            if (!subscriber.closed) {
                sub.add(this.schedule());
            }
        }));
        return sub;
    });
}
//# sourceMappingURL=scheduleArray.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/symbol/iterator.js":
/*!*************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/symbol/iterator.js ***!
  \*************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   $$iterator: () => (/* binding */ $$iterator),
/* harmony export */   getSymbolIterator: () => (/* binding */ getSymbolIterator),
/* harmony export */   iterator: () => (/* binding */ iterator)
/* harmony export */ });
/** PURE_IMPORTS_START  PURE_IMPORTS_END */
function getSymbolIterator() {
    if (typeof Symbol !== 'function' || !Symbol.iterator) {
        return '@@iterator';
    }
    return Symbol.iterator;
}
var iterator = /*@__PURE__*/ getSymbolIterator();
var $$iterator = iterator;
//# sourceMappingURL=iterator.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/util/isArrayLike.js":
/*!**************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/util/isArrayLike.js ***!
  \**************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   isArrayLike: () => (/* binding */ isArrayLike)
/* harmony export */ });
/** PURE_IMPORTS_START  PURE_IMPORTS_END */
var isArrayLike = (function (x) { return x && typeof x.length === 'number' && typeof x !== 'function'; });
//# sourceMappingURL=isArrayLike.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/util/isPromise.js":
/*!************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/util/isPromise.js ***!
  \************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   isPromise: () => (/* binding */ isPromise)
/* harmony export */ });
/** PURE_IMPORTS_START  PURE_IMPORTS_END */
function isPromise(value) {
    return !!value && typeof value.subscribe !== 'function' && typeof value.then === 'function';
}
//# sourceMappingURL=isPromise.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/util/isScheduler.js":
/*!**************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/util/isScheduler.js ***!
  \**************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   isScheduler: () => (/* binding */ isScheduler)
/* harmony export */ });
/** PURE_IMPORTS_START  PURE_IMPORTS_END */
function isScheduler(value) {
    return value && typeof value.schedule === 'function';
}
//# sourceMappingURL=isScheduler.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/util/subscribeTo.js":
/*!**************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/util/subscribeTo.js ***!
  \**************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   subscribeTo: () => (/* binding */ subscribeTo)
/* harmony export */ });
/* harmony import */ var _subscribeToArray__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ./subscribeToArray */ "./node_modules/rxjs/_esm5/internal/util/subscribeToArray.js");
/* harmony import */ var _subscribeToPromise__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./subscribeToPromise */ "./node_modules/rxjs/_esm5/internal/util/subscribeToPromise.js");
/* harmony import */ var _subscribeToIterable__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! ./subscribeToIterable */ "./node_modules/rxjs/_esm5/internal/util/subscribeToIterable.js");
/* harmony import */ var _subscribeToObservable__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./subscribeToObservable */ "./node_modules/rxjs/_esm5/internal/util/subscribeToObservable.js");
/* harmony import */ var _isArrayLike__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./isArrayLike */ "./node_modules/rxjs/_esm5/internal/util/isArrayLike.js");
/* harmony import */ var _isPromise__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./isPromise */ "./node_modules/rxjs/_esm5/internal/util/isPromise.js");
/* harmony import */ var _isObject__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! ./isObject */ "./node_modules/rxjs/_esm5/internal/util/isObject.js");
/* harmony import */ var _symbol_iterator__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../symbol/iterator */ "./node_modules/rxjs/_esm5/internal/symbol/iterator.js");
/* harmony import */ var _symbol_observable__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../symbol/observable */ "./node_modules/rxjs/_esm5/internal/symbol/observable.js");
/** PURE_IMPORTS_START _subscribeToArray,_subscribeToPromise,_subscribeToIterable,_subscribeToObservable,_isArrayLike,_isPromise,_isObject,_symbol_iterator,_symbol_observable PURE_IMPORTS_END */









var subscribeTo = function (result) {
    if (!!result && typeof result[_symbol_observable__WEBPACK_IMPORTED_MODULE_0__.observable] === 'function') {
        return (0,_subscribeToObservable__WEBPACK_IMPORTED_MODULE_1__.subscribeToObservable)(result);
    }
    else if ((0,_isArrayLike__WEBPACK_IMPORTED_MODULE_2__.isArrayLike)(result)) {
        return (0,_subscribeToArray__WEBPACK_IMPORTED_MODULE_3__.subscribeToArray)(result);
    }
    else if ((0,_isPromise__WEBPACK_IMPORTED_MODULE_4__.isPromise)(result)) {
        return (0,_subscribeToPromise__WEBPACK_IMPORTED_MODULE_5__.subscribeToPromise)(result);
    }
    else if (!!result && typeof result[_symbol_iterator__WEBPACK_IMPORTED_MODULE_6__.iterator] === 'function') {
        return (0,_subscribeToIterable__WEBPACK_IMPORTED_MODULE_7__.subscribeToIterable)(result);
    }
    else {
        var value = (0,_isObject__WEBPACK_IMPORTED_MODULE_8__.isObject)(result) ? 'an invalid object' : "'" + result + "'";
        var msg = "You provided " + value + " where a stream was expected."
            + ' You can provide an Observable, Promise, Array, or Iterable.';
        throw new TypeError(msg);
    }
};
//# sourceMappingURL=subscribeTo.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/util/subscribeToArray.js":
/*!*******************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/util/subscribeToArray.js ***!
  \*******************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   subscribeToArray: () => (/* binding */ subscribeToArray)
/* harmony export */ });
/** PURE_IMPORTS_START  PURE_IMPORTS_END */
var subscribeToArray = function (array) {
    return function (subscriber) {
        for (var i = 0, len = array.length; i < len && !subscriber.closed; i++) {
            subscriber.next(array[i]);
        }
        subscriber.complete();
    };
};
//# sourceMappingURL=subscribeToArray.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/util/subscribeToIterable.js":
/*!**********************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/util/subscribeToIterable.js ***!
  \**********************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   subscribeToIterable: () => (/* binding */ subscribeToIterable)
/* harmony export */ });
/* harmony import */ var _symbol_iterator__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../symbol/iterator */ "./node_modules/rxjs/_esm5/internal/symbol/iterator.js");
/** PURE_IMPORTS_START _symbol_iterator PURE_IMPORTS_END */

var subscribeToIterable = function (iterable) {
    return function (subscriber) {
        var iterator = iterable[_symbol_iterator__WEBPACK_IMPORTED_MODULE_0__.iterator]();
        do {
            var item = void 0;
            try {
                item = iterator.next();
            }
            catch (err) {
                subscriber.error(err);
                return subscriber;
            }
            if (item.done) {
                subscriber.complete();
                break;
            }
            subscriber.next(item.value);
            if (subscriber.closed) {
                break;
            }
        } while (true);
        if (typeof iterator.return === 'function') {
            subscriber.add(function () {
                if (iterator.return) {
                    iterator.return();
                }
            });
        }
        return subscriber;
    };
};
//# sourceMappingURL=subscribeToIterable.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/util/subscribeToObservable.js":
/*!************************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/util/subscribeToObservable.js ***!
  \************************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   subscribeToObservable: () => (/* binding */ subscribeToObservable)
/* harmony export */ });
/* harmony import */ var _symbol_observable__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../symbol/observable */ "./node_modules/rxjs/_esm5/internal/symbol/observable.js");
/** PURE_IMPORTS_START _symbol_observable PURE_IMPORTS_END */

var subscribeToObservable = function (obj) {
    return function (subscriber) {
        var obs = obj[_symbol_observable__WEBPACK_IMPORTED_MODULE_0__.observable]();
        if (typeof obs.subscribe !== 'function') {
            throw new TypeError('Provided object does not correctly implement Symbol.observable');
        }
        else {
            return obs.subscribe(subscriber);
        }
    };
};
//# sourceMappingURL=subscribeToObservable.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/util/subscribeToPromise.js":
/*!*********************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/util/subscribeToPromise.js ***!
  \*********************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   subscribeToPromise: () => (/* binding */ subscribeToPromise)
/* harmony export */ });
/* harmony import */ var _hostReportError__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./hostReportError */ "./node_modules/rxjs/_esm5/internal/util/hostReportError.js");
/** PURE_IMPORTS_START _hostReportError PURE_IMPORTS_END */

var subscribeToPromise = function (promise) {
    return function (subscriber) {
        promise.then(function (value) {
            if (!subscriber.closed) {
                subscriber.next(value);
                subscriber.complete();
            }
        }, function (err) { return subscriber.error(err); })
            .then(null, _hostReportError__WEBPACK_IMPORTED_MODULE_0__.hostReportError);
        return subscriber;
    };
};
//# sourceMappingURL=subscribeToPromise.js.map


/***/ }),

/***/ "./node_modules/rxjs/_esm5/internal/util/subscribeToResult.js":
/*!********************************************************************!*\
  !*** ./node_modules/rxjs/_esm5/internal/util/subscribeToResult.js ***!
  \********************************************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   subscribeToResult: () => (/* binding */ subscribeToResult)
/* harmony export */ });
/* harmony import */ var _InnerSubscriber__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../InnerSubscriber */ "./node_modules/rxjs/_esm5/internal/InnerSubscriber.js");
/* harmony import */ var _subscribeTo__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./subscribeTo */ "./node_modules/rxjs/_esm5/internal/util/subscribeTo.js");
/* harmony import */ var _Observable__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../Observable */ "./node_modules/rxjs/_esm5/internal/Observable.js");
/** PURE_IMPORTS_START _InnerSubscriber,_subscribeTo,_Observable PURE_IMPORTS_END */



function subscribeToResult(outerSubscriber, result, outerValue, outerIndex, innerSubscriber) {
    if (innerSubscriber === void 0) {
        innerSubscriber = new _InnerSubscriber__WEBPACK_IMPORTED_MODULE_0__.InnerSubscriber(outerSubscriber, outerValue, outerIndex);
    }
    if (innerSubscriber.closed) {
        return undefined;
    }
    if (result instanceof _Observable__WEBPACK_IMPORTED_MODULE_1__.Observable) {
        return result.subscribe(innerSubscriber);
    }
    return (0,_subscribeTo__WEBPACK_IMPORTED_MODULE_2__.subscribeTo)(result)(innerSubscriber);
}
//# sourceMappingURL=subscribeToResult.js.map


/***/ }),

/***/ "./webviewsrc/worldmap/graphutils.ts":
/*!*******************************************!*\
  !*** ./webviewsrc/worldmap/graphutils.ts ***!
  \*******************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   bboxCenter: () => (/* binding */ bboxCenter),
/* harmony export */   distanceHamming: () => (/* binding */ distanceHamming),
/* harmony export */   distanceSqr: () => (/* binding */ distanceSqr),
/* harmony export */   inBBox: () => (/* binding */ inBBox)
/* harmony export */ });
function inBBox(point, bbox) {
    return point.x >= bbox.x && point.x < bbox.x + bbox.w && point.y >= bbox.y && point.y < bbox.y + bbox.h;
}
function bboxCenter(bbox) {
    return {
        x: bbox.x + bbox.w / 2,
        y: bbox.y + bbox.h / 2,
    };
}
function distanceSqr(a, b) {
    return (a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y);
}
function distanceHamming(a, b) {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}


/***/ }),

/***/ "./webviewsrc/worldmap/index.ts":
/*!**************************************!*\
  !*** ./webviewsrc/worldmap/index.ts ***!
  \**************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony import */ var _loader__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./loader */ "./webviewsrc/worldmap/loader.ts");
/* harmony import */ var _viewpoint__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./viewpoint */ "./webviewsrc/worldmap/viewpoint.ts");
/* harmony import */ var _topbar__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ./topbar */ "./webviewsrc/worldmap/topbar.ts");
/* harmony import */ var _util_common__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../util/common */ "./webviewsrc/util/common.ts");
/* harmony import */ var _renderer__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ./renderer */ "./webviewsrc/worldmap/renderer.ts");
/* harmony import */ var rxjs__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! rxjs */ "./node_modules/rxjs/_esm5/internal/observable/fromEvent.js");






(0,rxjs__WEBPACK_IMPORTED_MODULE_5__.fromEvent)(window, 'load').subscribe(function () {
    hideBySupplyAreaFlag(window['__enableSupplyArea']);
    const state = (0,_util_common__WEBPACK_IMPORTED_MODULE_3__.getState)();
    const loader = new _loader__WEBPACK_IMPORTED_MODULE_0__.Loader();
    const mainCanvas = document.getElementById('main-canvas');
    const viewPoint = new _viewpoint__WEBPACK_IMPORTED_MODULE_1__.ViewPoint(mainCanvas, loader, _topbar__WEBPACK_IMPORTED_MODULE_2__.topBarHeight, state.viewPoint || { x: 0, y: -_topbar__WEBPACK_IMPORTED_MODULE_2__.topBarHeight, scale: 1 });
    const topBar = new _topbar__WEBPACK_IMPORTED_MODULE_2__.TopBar(mainCanvas, viewPoint, loader, state);
    const renderer = new _renderer__WEBPACK_IMPORTED_MODULE_4__.Renderer(mainCanvas, viewPoint, loader, topBar);
    (0,rxjs__WEBPACK_IMPORTED_MODULE_5__.fromEvent)(mainCanvas, 'contextmenu').subscribe(event => event.preventDefault());
    viewPoint.observable$.subscribe(setStateForKey('viewPoint'));
    topBar.viewMode$.subscribe(setStateForKey('viewMode'));
    topBar.colorSet$.subscribe(setStateForKey('colorSet'));
    topBar.selectedProvinceId$.subscribe(setStateForKey('selectedProvinceId'));
    topBar.selectedStateId$.subscribe(setStateForKey('selectedStateId'));
    topBar.selectedStrategicRegionId$.subscribe(setStateForKey('selectedStrategicRegionId'));
    topBar.selectedSupplyAreaId$.subscribe(setStateForKey('selectedSupplyAreaId'));
    topBar.warningFilter.selectedValues$.subscribe(setStateForKey('warningFilter'));
    topBar.display.selectedValues$.subscribe(setStateForKey('display'));
});
function setStateForKey(key) {
    return newValue => {
        (0,_util_common__WEBPACK_IMPORTED_MODULE_3__.setState)({ [key]: newValue });
    };
}
function hideBySupplyAreaFlag(enableSupplyArea) {
    const viewModes = document.getElementById('viewmode').getElementsByTagName('option');
    for (let i = 0; i < viewModes.length; i++) {
        const viewMode = viewModes[i];
        const attribute = viewMode.getAttribute('enablesupplyarea');
        if (attribute && attribute !== enableSupplyArea.toString()) {
            viewMode.remove();
        }
    }
    const colorSets = document.getElementById('colorset').getElementsByTagName('option');
    for (let i = 0; i < colorSets.length; i++) {
        const colorSet = colorSets[i];
        const attribute = colorSet.getAttribute('enablesupplyarea');
        if (attribute && attribute !== enableSupplyArea.toString()) {
            colorSet.remove();
        }
    }
    const displayOptions = document.getElementById('display').getElementsByTagName('div');
    for (let i = 0; i < displayOptions.length; i++) {
        const displayOption = displayOptions[i];
        const attribute = displayOption.getAttribute('enablesupplyarea');
        if (attribute && attribute !== enableSupplyArea.toString()) {
            displayOption.remove();
        }
    }
    const warningFilterOptions = document.getElementById('warningfilter').getElementsByTagName('div');
    for (let i = 0; i < warningFilterOptions.length; i++) {
        const warningFilterOption = warningFilterOptions[i];
        const attribute = warningFilterOption.getAttribute('enablesupplyarea');
        if (attribute && attribute !== enableSupplyArea.toString()) {
            warningFilterOption.remove();
        }
    }
}


/***/ }),

/***/ "./webviewsrc/worldmap/loader.ts":
/*!***************************************!*\
  !*** ./webviewsrc/worldmap/loader.ts ***!
  \***************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Loader: () => (/* binding */ Loader)
/* harmony export */ });
/* harmony import */ var _util_common__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../util/common */ "./webviewsrc/util/common.ts");
/* harmony import */ var _graphutils__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./graphutils */ "./webviewsrc/worldmap/graphutils.ts");
/* harmony import */ var _util_event__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../util/event */ "./webviewsrc/util/event.ts");
/* harmony import */ var _util_vscode__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../util/vscode */ "./webviewsrc/util/vscode.ts");
/* harmony import */ var rxjs__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! rxjs */ "./node_modules/rxjs/_esm5/internal/BehaviorSubject.js");
/* harmony import */ var rxjs__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! rxjs */ "./node_modules/rxjs/_esm5/internal/Subject.js");
/* harmony import */ var rxjs__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! rxjs */ "./node_modules/rxjs/_esm5/internal/observable/fromEvent.js");





class Loader extends _util_event__WEBPACK_IMPORTED_MODULE_2__.Subscriber {
    constructor() {
        super();
        this.loading$ = new rxjs__WEBPACK_IMPORTED_MODULE_4__.BehaviorSubject(false);
        this.progress = 0;
        this.progressText = '';
        this.writableWorldMap$ = new rxjs__WEBPACK_IMPORTED_MODULE_5__.Subject();
        this.worldMap$ = this.writableWorldMap$;
        this.writableProgress$ = new rxjs__WEBPACK_IMPORTED_MODULE_4__.BehaviorSubject({ progress: 0, progressText: '' });
        this.progress$ = this.writableProgress$;
        this.loadingQueue = [];
        this.loadingQueueStartLength = 0;
        this.worldMap = new FEWorldMapClass();
        this.load();
        this.worldMap$.subscribe(wm => window['worldMap'] = wm);
    }
    refresh() {
        this.worldMap = new FEWorldMapClass();
        this.writableWorldMap$.next(this.worldMap);
        _util_vscode__WEBPACK_IMPORTED_MODULE_3__.vscode.postMessage({ command: 'loaded', force: true });
        this.loading$.next(true);
    }
    load() {
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_6__.fromEvent)(window, 'message').subscribe(event => {
            var _a, _b, _c, _d, _e, _f, _g;
            const message = event.data;
            switch (message.command) {
                case 'provincemapsummary':
                    this.loadingProvinceMap = Object.assign({}, message.data);
                    this.loadingProvinceMap.provinces = new Array(this.loadingProvinceMap.provincesCount);
                    this.loadingProvinceMap.states = new Array(this.loadingProvinceMap.statesCount);
                    this.loadingProvinceMap.countries = new Array(this.loadingProvinceMap.countriesCount);
                    this.loadingProvinceMap.strategicRegions = new Array(this.loadingProvinceMap.strategicRegionsCount);
                    console.log(message.data);
                    this.startLoading();
                    break;
                case 'provinces':
                    this.receiveData((_a = this.loadingProvinceMap) === null || _a === void 0 ? void 0 : _a.provinces, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'states':
                    this.receiveData((_b = this.loadingProvinceMap) === null || _b === void 0 ? void 0 : _b.states, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'countries':
                    this.receiveData((_c = this.loadingProvinceMap) === null || _c === void 0 ? void 0 : _c.countries, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'strategicregions':
                    this.receiveData((_d = this.loadingProvinceMap) === null || _d === void 0 ? void 0 : _d.strategicRegions, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'supplyareas':
                    this.receiveData((_e = this.loadingProvinceMap) === null || _e === void 0 ? void 0 : _e.supplyAreas, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'railways':
                    this.receiveData((_f = this.loadingProvinceMap) === null || _f === void 0 ? void 0 : _f.railways, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'supplynodes':
                    this.receiveData((_g = this.loadingProvinceMap) === null || _g === void 0 ? void 0 : _g.supplyNodes, message.start, message.end, message.data);
                    this.loadNext();
                    break;
                case 'warnings':
                    if (this.loadingProvinceMap) {
                        this.loadingProvinceMap.warnings = JSON.parse(message.data);
                        this.loadNext();
                    }
                    break;
                case 'continents':
                    if (this.loadingProvinceMap) {
                        this.loadingProvinceMap.continents = JSON.parse(message.data);
                        this.loadNext();
                    }
                    break;
                case 'terrains':
                    if (this.loadingProvinceMap) {
                        this.loadingProvinceMap.terrains = JSON.parse(message.data);
                        this.loadNext();
                    }
                    break;
                case 'resources':
                    if (this.loadingProvinceMap) {
                        this.loadingProvinceMap.resources = JSON.parse(message.data);
                        this.loadNext();
                    }
                    break;
                case 'progress':
                    this.progressText = message.data;
                    this.writableProgress$.next({ progressText: this.progressText, progress: this.progress });
                    break;
                case 'error':
                    this.progressText = message.data;
                    this.writableProgress$.next({ progressText: this.progressText, progress: this.progress });
                    this.loading$.next(false);
                    break;
            }
        }));
        _util_vscode__WEBPACK_IMPORTED_MODULE_3__.vscode.postMessage({ command: 'loaded', force: false });
        this.loading$.next(true);
    }
    startLoading() {
        if (!this.loadingProvinceMap) {
            return;
        }
        this.loadingQueue.length = 0;
        this.queueLoadingRequest('requestcountries', this.loadingProvinceMap.countriesCount, 300);
        this.queueLoadingRequest('requeststrategicregions', this.loadingProvinceMap.strategicRegionsCount, 300);
        this.queueLoadingRequest('requeststrategicregions', -this.loadingProvinceMap.badStrategicRegionsCount, 300, this.loadingProvinceMap.badStrategicRegionsCount);
        this.queueLoadingRequest('requestsupplyareas', this.loadingProvinceMap.supplyAreasCount, 300);
        this.queueLoadingRequest('requestsupplyareas', -this.loadingProvinceMap.badSupplyAreasCount, 300, this.loadingProvinceMap.badSupplyAreasCount);
        this.queueLoadingRequest('requeststates', this.loadingProvinceMap.statesCount, 300);
        this.queueLoadingRequest('requeststates', -this.loadingProvinceMap.badStatesCount, 300, this.loadingProvinceMap.badStatesCount);
        this.queueLoadingRequest('requestprovinces', this.loadingProvinceMap.provincesCount, 300);
        this.queueLoadingRequest('requestprovinces', -this.loadingProvinceMap.badProvincesCount, 300, this.loadingProvinceMap.badProvincesCount);
        this.queueLoadingRequest('requestrailways', this.loadingProvinceMap.railwaysCount, 1000);
        this.queueLoadingRequest('requestsupplynodes', this.loadingProvinceMap.supplyNodesCount, 2000);
        this.loadingQueueStartLength = this.loadingQueue.length;
        this.progressText = '';
        this.loadNext();
    }
    queueLoadingRequest(command, count, step, offset = 0) {
        for (let i = offset, j = 0; j < count; i += step, j += step) {
            this.loadingQueue.push({
                command,
                start: i,
                end: Math.min(i + step, offset + count),
            });
        }
    }
    loadNext(updateMap = true) {
        this.progress = 1 - this.loadingQueue.length / this.loadingQueueStartLength;
        if (updateMap) {
            this.worldMap = new FEWorldMapClass(this.loadingProvinceMap);
            this.writableWorldMap$.next(this.worldMap);
        }
        if (this.loadingQueue.length === 0) {
            this.loading$.next(false);
        }
        else {
            _util_vscode__WEBPACK_IMPORTED_MODULE_3__.vscode.postMessage(this.loadingQueue.shift());
        }
        this.writableProgress$.next({ progressText: this.progressText, progress: this.progress });
    }
    receiveData(arr, start, end, data) {
        if (arr) {
            (0,_util_common__WEBPACK_IMPORTED_MODULE_0__.copyArray)(JSON.parse(data), arr, 0, start, end - start);
        }
    }
}
class FEWorldMapClass {
    constructor(worldMap) {
        this.getProvinceById = (provinceId) => {
            var _a;
            return provinceId ? (_a = this.provinces[provinceId]) !== null && _a !== void 0 ? _a : undefined : undefined;
        };
        this.getStateById = (stateId) => {
            var _a;
            return stateId ? (_a = this.states[stateId]) !== null && _a !== void 0 ? _a : undefined : undefined;
        };
        this.getStrategicRegionById = (strategicRegionId) => {
            var _a;
            return strategicRegionId ? (_a = this.strategicRegions[strategicRegionId]) !== null && _a !== void 0 ? _a : undefined : undefined;
        };
        this.getSupplyAreaById = (supplyAreaId) => {
            var _a;
            return supplyAreaId ? (_a = this.supplyAreas[supplyAreaId]) !== null && _a !== void 0 ? _a : undefined : undefined;
        };
        Object.assign(this, worldMap !== null && worldMap !== void 0 ? worldMap : {
            width: 0, height: 0,
            provinces: [], states: [], countries: [], warnings: [], continents: [], strategicRegions: [], supplyAreas: [], terrains: [],
            railways: [], supplyNodes: [], resources: [], rivers: [],
            provincesCount: 0, statesCount: 0, countriesCount: 0, strategicRegionsCount: 0, supplyAreasCount: 0,
            badProvincesCount: 0, badStatesCount: 0, badStrategicRegionsCount: 0, badSupplyAreasCount: 0,
            railwaysCount: 0, supplyNodesCount: 0,
        });
    }
    getStateByProvinceId(provinceId) {
        let resultState = undefined;
        this.forEachState(state => {
            if (state.provinces.includes(provinceId)) {
                resultState = state;
                return true;
            }
        });
        return resultState;
    }
    getStrategicRegionByProvinceId(provinceId) {
        let resultStrategicRegion = undefined;
        this.forEachStrategicRegion(strategicRegion => {
            if (strategicRegion.provinces.includes(provinceId)) {
                resultStrategicRegion = strategicRegion;
                return true;
            }
        });
        return resultStrategicRegion;
    }
    getSupplyAreaByStateId(stateId) {
        let resultSupplyArea = undefined;
        this.forEachSupplyArea(supplyArea => {
            if (supplyArea.states.includes(stateId)) {
                resultSupplyArea = supplyArea;
                return true;
            }
        });
        return resultSupplyArea;
    }
    getRailwayLevelByProvinceId(provinceId) {
        let resultRailwayLevel = -1;
        this.forEachRailway(railway => {
            if (railway.provinces.includes(provinceId)) {
                resultRailwayLevel = Math.max(resultRailwayLevel, railway.level);
            }
        });
        return resultRailwayLevel === -1 ? undefined : resultRailwayLevel;
    }
    getSupplyNodeByProvinceId(provinceId) {
        let resultSupplyNode = undefined;
        this.forEachSupplyNode(supplyNode => {
            if (supplyNode.province === provinceId) {
                resultSupplyNode = supplyNode;
                return true;
            }
        });
        return resultSupplyNode;
    }
    getProvinceByPosition(x, y) {
        const point = { x, y };
        let resultProvince = undefined;
        this.forEachProvince(province => {
            if ((0,_graphutils__WEBPACK_IMPORTED_MODULE_1__.inBBox)(point, province.boundingBox) && province.coverZones.some(z => (0,_graphutils__WEBPACK_IMPORTED_MODULE_1__.inBBox)(point, z))) {
                resultProvince = province;
                return true;
            }
        });
        return resultProvince;
    }
    getProvinceToStateMap() {
        const result = {};
        this.forEachState(state => state.provinces.forEach(p => {
            result[p] = state.id;
        }));
        return result;
    }
    getProvinceToStrategicRegionMap() {
        const result = {};
        this.forEachStrategicRegion(strategicRegion => strategicRegion.provinces.forEach(p => {
            result[p] = strategicRegion.id;
        }));
        return result;
    }
    getStateToSupplyAreaMap() {
        const result = {};
        this.forEachSupplyArea(supplyArea => supplyArea.states.forEach(s => {
            result[s] = supplyArea.id;
        }));
        return result;
    }
    forEachProvince(callback) {
        const count = this.provincesCount;
        for (let i = this.badProvincesCount; i < count; i++) {
            const province = this.provinces[i];
            if (province && callback(province)) {
                break;
            }
        }
    }
    forEachState(callback) {
        const count = this.statesCount;
        for (let i = this.badStatesCount; i < count; i++) {
            const state = this.states[i];
            if (state && callback(state)) {
                break;
            }
        }
    }
    forEachStrategicRegion(callback) {
        const count = this.strategicRegionsCount;
        for (let i = this.badStrategicRegionsCount; i < count; i++) {
            const strategicRegion = this.strategicRegions[i];
            if (strategicRegion && callback(strategicRegion)) {
                break;
            }
        }
    }
    forEachSupplyArea(callback) {
        const count = this.supplyAreasCount;
        for (let i = this.badSupplyAreasCount; i < count; i++) {
            const supplyArea = this.supplyAreas[i];
            if (supplyArea && callback(supplyArea)) {
                break;
            }
        }
    }
    forEachRailway(callback) {
        const count = this.railwaysCount;
        for (let i = 0; i < count; i++) {
            const railway = this.railways[i];
            if (railway && callback(railway)) {
                break;
            }
        }
    }
    forEachSupplyNode(callback) {
        const count = this.supplyNodesCount;
        for (let i = 0; i < count; i++) {
            const supplyNode = this.supplyNodes[i];
            if (supplyNode && callback(supplyNode)) {
                break;
            }
        }
    }
    getProvinceWarnings(province, state, strategicRegion, supplyArea) {
        return this.warnings
            .filter(v => v.source.some(s => (province && s.type === 'province' && (s.id === province.id || s.color === province.color)) ||
            (state && s.type === 'state' && s.id === state.id) ||
            (strategicRegion && s.type === 'strategicregion' && s.id === strategicRegion.id) ||
            (supplyArea && s.type === 'supplyarea' && s.id === supplyArea.id)))
            .map(v => v.text);
    }
    getStateWarnings(state, supplyArea) {
        return this.warnings
            .filter(v => v.source.some(s => (s.type === 'state' && s.id === state.id) ||
            (supplyArea && s.type === 'supplyarea' && s.id === supplyArea.id)))
            .map(v => v.text);
    }
    getStrategicRegionWarnings(strategicRegion) {
        return this.warnings.filter(v => v.source.some(s => s.type === 'strategicregion' && s.id === strategicRegion.id)).map(v => v.text);
    }
    getSupplyAreaWarnings(supplyArea) {
        return this.warnings.filter(v => v.source.some(s => s.type === 'supplyarea' && s.id === supplyArea.id)).map(v => v.text);
    }
    getRiverWarnings(riverIndex) {
        return this.warnings.filter(v => v.source.some(s => s.type === 'river' && s.index === riverIndex)).map(v => v.text);
    }
}


/***/ }),

/***/ "./webviewsrc/worldmap/renderer.ts":
/*!*****************************************!*\
  !*** ./webviewsrc/worldmap/renderer.ts ***!
  \*****************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   Renderer: () => (/* binding */ Renderer)
/* harmony export */ });
/* harmony import */ var _graphutils__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./graphutils */ "./webviewsrc/worldmap/graphutils.ts");
/* harmony import */ var _topbar__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./topbar */ "./webviewsrc/worldmap/topbar.ts");
/* harmony import */ var _util_event__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../util/event */ "./webviewsrc/util/event.ts");
/* harmony import */ var _util_common__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../util/common */ "./webviewsrc/util/common.ts");
/* harmony import */ var _util_i18n__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../util/i18n */ "./webviewsrc/util/i18n.ts");
/* harmony import */ var lodash__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! lodash */ "./node_modules/lodash/lodash.js");
/* harmony import */ var lodash__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(lodash__WEBPACK_IMPORTED_MODULE_5__);
/* harmony import */ var rxjs__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! rxjs */ "./node_modules/rxjs/_esm5/internal/observable/fromEvent.js");
/* harmony import */ var rxjs__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! rxjs */ "./node_modules/rxjs/_esm5/internal/observable/combineLatest.js");
/* harmony import */ var rxjs_operators__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! rxjs/operators */ "./node_modules/rxjs/_esm5/internal/operators/distinctUntilChanged.js");








const landWarning = 0xE02020;
const landNoWarning = 0x7FFF7F;
const waterWarning = 0xC00000;
const waterNoWarning = 0x20E020;
const renderScaleByViewMode = {
    province: { edge: 2, labels: 3 },
    state: { edge: 1, labels: 1 },
    strategicregion: { edge: 0.25, labels: 0.25 },
    supplyarea: { edge: 0.5, labels: 1 },
    warnings: { edge: 2, labels: 3 },
};
class Renderer extends _util_event__WEBPACK_IMPORTED_MODULE_2__.Subscriber {
    constructor(mainCanvas, viewPoint, loader, topBar) {
        super();
        this.mainCanvas = mainCanvas;
        this.viewPoint = viewPoint;
        this.loader = loader;
        this.topBar = topBar;
        this.canvasWidth = 0;
        this.canvasHeight = 0;
        this.cursorX = 0;
        this.cursorY = 0;
        this.reloadImages = () => {
            for (const resource of this.loader.worldMap.resources) {
                const image = new Image();
                image.onload = () => {
                    Renderer.resourceImages[resource.name] = image;
                };
                image.src = resource.imageUri;
            }
        };
        this.renderCanvas = () => {
            if (this.canvasWidth <= 0 && this.canvasHeight <= 0) {
                return;
            }
            const backCanvasContext = this.backCanvasContext;
            backCanvasContext.fillStyle = 'black';
            backCanvasContext.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
            backCanvasContext.fillStyle = 'white';
            backCanvasContext.font = '12px sans-serif';
            this.renderMap();
            backCanvasContext.drawImage(this.mapCanvas, 0, 0);
            const viewMode = this.topBar.viewMode$.value;
            switch (viewMode) {
                case 'province':
                case 'warnings':
                    this.renderProvinceHoverSelection(this.loader.worldMap);
                    break;
                case 'state':
                    this.renderStateHoverSelection(this.loader.worldMap);
                    break;
                case 'strategicregion':
                    this.renderStrategicRegionHoverSelection(this.loader.worldMap);
                    break;
                case 'supplyarea':
                    this.renderSupplyAreaHoverSelection(this.loader.worldMap);
                    break;
            }
            if (this.loader.progressText !== '') {
                this.renderLoadingText(this.loader.progressText);
            }
            else if (this.loader.loading$.value) {
                this.renderLoadingText((0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.progress.visualizing', 'Visualizing map data: {0}', Math.round(this.loader.progress * 100) + '%'));
            }
            this.mainCanvasContext.drawImage(this.backCanvas, 0, 0);
        };
        this.resizeCanvas = () => {
            this.canvasWidth = this.mainCanvas.width = this.mapCanvas.width = this.backCanvas.width = window.innerWidth;
            this.canvasHeight = this.mainCanvas.height = this.mapCanvas.height = this.backCanvas.height = window.innerHeight;
            this.renderCanvas();
        };
        this.oldMapState = undefined;
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_6__.fromEvent)(window, 'resize').subscribe(this.resizeCanvas));
        this.mainCanvasContext = this.mainCanvas.getContext('2d');
        this.backCanvas = document.createElement('canvas');
        this.backCanvasContext = this.backCanvas.getContext('2d');
        this.mapCanvas = document.createElement('canvas');
        this.registerCanvasEventHandlers();
        this.resizeCanvas();
        this.addSubscription(loader.worldMap$.subscribe(this.reloadImages));
        this.addSubscription(loader.worldMap$.subscribe(this.renderCanvas));
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_7__.combineLatest)([
            loader.progress$,
            viewPoint.observable$,
            topBar.viewMode$,
            topBar.colorSet$,
            topBar.hoverProvinceId$,
            topBar.selectedProvinceId$,
            topBar.hoverStateId$,
            topBar.selectedStateId$,
            topBar.hoverStrategicRegionId$,
            topBar.selectedStrategicRegionId$,
            topBar.hoverSupplyAreaId$,
            topBar.selectedSupplyAreaId$,
            topBar.warningFilter.selectedValues$,
            topBar.display.selectedValues$,
        ]).pipe((0,rxjs_operators__WEBPACK_IMPORTED_MODULE_8__.distinctUntilChanged)((x, y) => x.every((v, i) => v === y[i]))).subscribe(this.renderCanvas));
    }
    renderMap() {
        const worldMap = this.loader.worldMap;
        const displayOptions = this.topBar.display.selectedValues$.value;
        const newMapState = Object.assign({ worldMap, canvasWidth: this.canvasWidth, canvasHeight: this.canvasHeight, viewMode: this.topBar.viewMode$.value, colorSet: this.topBar.colorSet$.value, warningFilter: this.topBar.warningFilter.selectedValues$.value, edgeVisible: displayOptions.includes('edge'), labelVisible: displayOptions.includes('label'), adaptZooming: displayOptions.includes('adaptzooming'), fastRendering: displayOptions.includes('fastrending'), supplyVisible: displayOptions.includes('supply'), riverVisible: displayOptions.includes('river') }, this.viewPoint.toJson());
        // State not changed
        if (this.oldMapState !== undefined && Object.keys(newMapState).every(k => this.oldMapState[k] === newMapState[k])) {
            return;
        }
        this.oldMapState = newMapState;
        Renderer.renderMapImpl(this.mapCanvas, this.topBar, this.viewPoint, worldMap, newMapState.fastRendering ? {} : { preciseEdge: true, overwriteRenderPrecision: 1 });
    }
    static renderMapImpl(canvas, topBar, viewPoint, worldMap, otherRenderContext) {
        const mapCanvasContext = canvas.getContext('2d');
        mapCanvasContext.fillStyle = 'black';
        mapCanvasContext.fillRect(0, 0, canvas.width, canvas.height);
        const renderContext = Object.assign({ topBar,
            viewPoint,
            mapCanvasContext, provinceToState: worldMap.getProvinceToStateMap(), provinceToStrategicRegion: worldMap.getProvinceToStrategicRegionMap(), stateToSupplyArea: worldMap.getStateToSupplyAreaMap(), renderedProvincesByOffset: {}, renderedProvincesById: {}, extraState: undefined }, otherRenderContext);
        const mapZone = { x: 0, y: 0, w: worldMap.width, h: worldMap.height };
        Renderer.renderAllOffsets(viewPoint, mapZone, worldMap.width, xOffset => Renderer.renderMapBackground(worldMap, xOffset, renderContext));
        renderContext.renderedProvinces = Object.values(renderContext.renderedProvincesById);
        Renderer.renderAllOffsets(viewPoint, mapZone, worldMap.width, xOffset => Renderer.renderMapForeground(worldMap, xOffset, renderContext));
    }
    static renderMapBackground(worldMap, xOffset, renderContext) {
        var _a;
        const { mapCanvasContext: context, topBar, viewPoint, overwriteRenderPrecision } = renderContext;
        const scale = viewPoint.scale;
        const renderedProvinces = (_a = renderContext.renderedProvincesByOffset[xOffset]) !== null && _a !== void 0 ? _a : [];
        const { renderedProvincesById } = renderContext;
        renderContext.renderedProvincesByOffset[xOffset] = renderedProvinces;
        const edgeVisible = Renderer.isEdgeVisible(topBar, viewPoint);
        worldMap.forEachProvince(province => {
            if (renderContext.viewPoint.bboxInView(province.boundingBox, xOffset)) {
                const color = getColorByColorSet(topBar.colorSet$.value, province, worldMap, renderContext);
                context.fillStyle = toColor(color);
                Renderer.renderProvince(viewPoint, context, province, scale, xOffset, overwriteRenderPrecision);
                renderedProvinces.push(province);
                renderedProvincesById[province.id] = province;
            }
            if (edgeVisible) {
                for (const edge of province.edges) {
                    if (edge.path.length > 0) {
                        continue;
                    }
                    const toProvince = worldMap.getProvinceById(edge.to);
                    if (!toProvince) {
                        continue;
                    }
                    const [startPoint, endPoint] = findNearestPoints(edge.start, edge.stop, province, toProvince);
                    if (renderContext.viewPoint.lineInView(startPoint, endPoint, xOffset)) {
                        if (!(province.id in renderedProvincesById)) {
                            renderedProvinces.push(province);
                            renderedProvincesById[province.id] = province;
                        }
                        if (!(edge.to in renderedProvincesById)) {
                            renderedProvinces.push(toProvince);
                            renderedProvincesById[edge.to] = toProvince;
                        }
                    }
                }
            }
        });
    }
    static renderMapForeground(worldMap, xOffset, renderContext) {
        const { mapCanvasContext: context, topBar, viewPoint } = renderContext;
        if (Renderer.isRiverVisible(topBar, viewPoint)) {
            Renderer.renderRivers(renderContext, worldMap, context, xOffset);
        }
        if (Renderer.isEdgeVisible(topBar, viewPoint)) {
            Renderer.renderAllEdges(renderContext, worldMap, context, xOffset);
        }
        if (Renderer.isSupplyVisible(topBar)) {
            Renderer.renderSupplyRelated(renderContext, worldMap, context, xOffset);
        }
        if (Renderer.isLabelVisible(topBar, viewPoint)) {
            Renderer.renderMapLabels(renderContext, worldMap, context, xOffset);
        }
    }
    static isEdgeVisible(topBar, viewPoint) {
        if (topBar.display.selectedValues$.value.includes('adaptzooming')) {
            const viewMode = topBar.viewMode$.value;
            const renderScale = renderScaleByViewMode[viewMode];
            const scale = viewPoint.scale;
            return renderScale.edge <= scale && topBar.display.selectedValues$.value.includes('edge');
        }
        return topBar.display.selectedValues$.value.includes('edge');
    }
    static isLabelVisible(topBar, viewPoint) {
        if (topBar.display.selectedValues$.value.includes('adaptzooming')) {
            const viewMode = topBar.viewMode$.value;
            const renderScale = renderScaleByViewMode[viewMode];
            const scale = viewPoint.scale;
            return renderScale.labels <= scale && topBar.display.selectedValues$.value.includes('label');
        }
        return topBar.display.selectedValues$.value.includes('label');
    }
    isMouseHighlightVisible() {
        return this.topBar.display.selectedValues$.value.includes('mousehighlight');
    }
    isTooltipVisible() {
        return this.topBar.display.selectedValues$.value.includes('tooltip');
    }
    static isSupplyVisible(topBar) {
        return topBar.display.selectedValues$.value.includes('supply');
    }
    static isRiverVisible(topBar, viewPoint) {
        if (topBar.display.selectedValues$.value.includes('adaptzooming')) {
            return 1 <= viewPoint.scale && topBar.display.selectedValues$.value.includes('river');
        }
        return topBar.display.selectedValues$.value.includes('river');
    }
    static renderAllEdges(renderContext, worldMap, context, xOffset) {
        var _a;
        const renderedProvinces = (_a = renderContext.renderedProvincesByOffset[xOffset]) !== null && _a !== void 0 ? _a : [];
        const preciseEdge = renderContext.preciseEdge;
        context.strokeStyle = 'black';
        context.beginPath();
        for (const province of renderedProvinces) {
            Renderer.renderEdges(renderContext, province, worldMap, context, xOffset, false, preciseEdge);
        }
        context.stroke();
        context.strokeStyle = 'red';
        context.beginPath();
        for (const province of renderedProvinces) {
            Renderer.renderEdges(renderContext, province, worldMap, context, xOffset, true, preciseEdge);
        }
        context.stroke();
    }
    static renderMapLabels(renderContext, worldMap, context, xOffset) {
        var _a;
        const { provinceToState, provinceToStrategicRegion, stateToSupplyArea, topBar, viewPoint } = renderContext;
        const renderedProvinces = (_a = renderContext.renderedProvincesByOffset[xOffset]) !== null && _a !== void 0 ? _a : [];
        const viewMode = topBar.viewMode$.value;
        const colorSet = topBar.colorSet$.value;
        const showSupply = Renderer.isSupplyVisible(topBar);
        context.font = '10px sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        if (viewMode === 'province' || viewMode === 'warnings') {
            for (const province of renderedProvinces) {
                const provinceColor = showSupply && worldMap.getSupplyNodeByProvinceId(province.id) ? 0xFF0000 :
                    getColorByColorSet(colorSet, province, worldMap, renderContext);
                context.fillStyle = toColor(getHighConstrastColor(provinceColor));
                const labelPosition = province.centerOfMass;
                context.fillText(province.id.toString(), viewPoint.convertX(labelPosition.x + xOffset), viewPoint.convertY(labelPosition.y));
            }
        }
        else {
            const renderedRegions = {};
            const regionMap = viewMode === 'state' ? provinceToState : provinceToStrategicRegion;
            const getRegionById = viewMode === 'state' ? worldMap.getStateById : viewMode === 'supplyarea' ? worldMap.getSupplyAreaById : worldMap.getStrategicRegionById;
            for (const province of renderedProvinces) {
                const stateId = viewMode === 'supplyarea' ? provinceToState[province.id] : undefined;
                const regionId = viewMode === 'supplyarea' ? (stateId !== undefined ? stateToSupplyArea[stateId] : undefined) : regionMap[province.id];
                if (regionId !== undefined && !renderedRegions[regionId]) {
                    renderedRegions[regionId] = true;
                    const region = getRegionById(regionId);
                    if (region) {
                        const labelPosition = region.centerOfMass;
                        const provinceAtLabel = worldMap.getProvinceByPosition(labelPosition.x, labelPosition.y);
                        const provinceColor = getColorByColorSet(colorSet, provinceAtLabel !== null && provinceAtLabel !== void 0 ? provinceAtLabel : province, worldMap, renderContext);
                        context.fillStyle = toColor(getHighConstrastColor(provinceColor));
                        context.fillText(region.id.toString(), viewPoint.convertX(labelPosition.x + xOffset), viewPoint.convertY(labelPosition.y));
                        if (viewMode === 'state' && colorSet === 'resources') {
                            const { width } = Renderer.getResourcesSize(region, 0.7, 16);
                            Renderer.renderResources(context, region, viewPoint.convertX(labelPosition.x + xOffset) - width / 2, viewPoint.convertY(labelPosition.y) + 5, 0.7, 16);
                        }
                    }
                }
            }
        }
    }
    static renderEdges(renderContext, province, worldMap, context, xOffset, isRed, preciseEdge) {
        var _a, _b, _c, _d;
        const { provinceToState, provinceToStrategicRegion, stateToSupplyArea, renderedProvinces, topBar, viewPoint } = renderContext;
        const scale = viewPoint.scale;
        const viewMode = topBar.viewMode$.value;
        context.lineWidth = 2;
        for (const provinceEdge of province.edges) {
            if (!('path' in provinceEdge)) {
                continue;
            }
            if (provinceEdge.to > province.id) {
                continue;
            }
            const stateFromId = provinceToState[province.id];
            const stateToId = provinceToState[provinceEdge.to];
            const stateFromImpassable = (_b = (_a = worldMap.getStateById(stateFromId)) === null || _a === void 0 ? void 0 : _a.impassable) !== null && _b !== void 0 ? _b : false;
            const stateToImpassable = (_d = (_c = worldMap.getStateById(stateToId)) === null || _c === void 0 ? void 0 : _c.impassable) !== null && _d !== void 0 ? _d : false;
            const impassable = provinceEdge.type === 'impassable' || stateFromImpassable !== stateToImpassable;
            const paths = provinceEdge.path;
            if ((impassable || (paths.length === 0 && provinceEdge.type !== 'impassable')) !== isRed) {
                continue;
            }
            const strategicRegionFromId = provinceToStrategicRegion[province.id];
            const strategicRegionToId = provinceToStrategicRegion[provinceEdge.to];
            if (!impassable && paths.length > 0) {
                if (viewMode === 'state') {
                    if (stateFromId === stateToId && (stateFromId !== undefined || strategicRegionFromId === strategicRegionToId)) {
                        continue;
                    }
                }
                else if (viewMode === 'strategicregion') {
                    if (strategicRegionFromId === strategicRegionToId) {
                        continue;
                    }
                }
                else if (viewMode === 'supplyarea') {
                    if ((stateFromId === stateToId && (stateFromId !== undefined || strategicRegionFromId === strategicRegionToId)) ||
                        (stateFromId !== undefined && stateToId !== undefined && stateToSupplyArea[stateFromId] === stateToSupplyArea[stateToId])) {
                        continue;
                    }
                }
            }
            for (const path of paths) {
                if (path.length === 0) {
                    continue;
                }
                context.moveTo(viewPoint.convertX(path[0].x + xOffset), viewPoint.convertY(path[0].y));
                for (let j = 0; j < path.length; j++) {
                    if (!preciseEdge && scale <= 4 && j % (scale < 1 ? Math.floor(10 / scale) : 6 - scale) !== 0 && !isCriticalPoint(path, j)) {
                        continue;
                    }
                    const pos = path[j];
                    context.lineTo(viewPoint.convertX(pos.x + xOffset), viewPoint.convertY(pos.y));
                }
            }
            if (paths.length === 0 && provinceEdge.type !== 'impassable') {
                const toProvince = renderedProvinces === null || renderedProvinces === void 0 ? void 0 : renderedProvinces.find(p => p.id === provinceEdge.to);
                const [startPoint, endPoint] = findNearestPoints(provinceEdge.start, provinceEdge.stop, province, toProvince);
                context.moveTo(viewPoint.convertX(startPoint.x + xOffset), viewPoint.convertY(startPoint.y));
                context.lineTo(viewPoint.convertX(endPoint.x + xOffset), viewPoint.convertY(endPoint.y));
            }
        }
    }
    static renderSupplyRelated(renderContext, worldMap, context, xOffset) {
        const { renderedProvincesById, viewPoint } = renderContext;
        context.strokeStyle = 'rgb(200, 0, 0)';
        worldMap.forEachRailway(railway => {
            if (railway.provinces.every(id => !renderedProvincesById[id])) {
                return;
            }
            context.beginPath();
            context.lineWidth = Math.min(10, 2 * railway.level);
            let hasProvince = false;
            for (let i = 0; i < railway.provinces.length; i++) {
                const province = worldMap.getProvinceById(railway.provinces[i]);
                if (province) {
                    if (!hasProvince) {
                        context.moveTo(viewPoint.convertX(province.centerOfMass.x + xOffset), viewPoint.convertY(province.centerOfMass.y));
                    }
                    else {
                        context.lineTo(viewPoint.convertX(province.centerOfMass.x + xOffset), viewPoint.convertY(province.centerOfMass.y));
                    }
                    hasProvince = true;
                }
                else {
                    context.stroke();
                    hasProvince = false;
                }
            }
            if (hasProvince) {
                context.stroke();
            }
        });
        context.fillStyle = 'rgb(200, 0, 0)';
        const size = Math.min(30, viewPoint.scale * 10);
        worldMap.forEachSupplyNode(supplyNode => {
            const province = renderedProvincesById[supplyNode.province];
            if (province) {
                const x = viewPoint.convertX(province.centerOfMass.x + xOffset);
                const y = viewPoint.convertY(province.centerOfMass.y);
                context.fillRect(x - size / 2, y - size / 2, size, size);
            }
        });
    }
    static renderRivers(renderContext, worldMap, context, xOffset) {
        const { viewPoint, topBar } = renderContext;
        const showRiverWarning = topBar.colorSet$.value === 'warnings' && topBar.warningFilter.selectedValues$.value.includes('river');
        const riverColors = [
            'rgb(0, 255, 0)',
            'rgb(255, 0, 0)',
            'rgb(255, 252, 0)',
            'rgb(0, 225, 255)',
            'rgb(0, 200, 255)',
            'rgb(0, 150, 255)',
            'rgb(0, 100, 255)',
            'rgb(0, 0, 255)',
            'rgb(0, 0, 255)',
            'rgb(0, 0, 200)',
            'rgb(0, 0, 150)',
            'rgb(0, 0, 100)',
        ];
        const warningColor = toColor(waterWarning);
        for (let i = 0; i < worldMap.rivers.length; i++) {
            const river = worldMap.rivers[i];
            if (!viewPoint.bboxInView(river.boundingBox, xOffset)) {
                continue;
            }
            const hasWarning = showRiverWarning && worldMap.getRiverWarnings(i).length > 0;
            for (const key in river.colors) {
                const index = parseInt(key, 10);
                const x = index % river.boundingBox.w + river.boundingBox.x;
                const y = Math.floor(index / river.boundingBox.w) + river.boundingBox.y;
                const color = river.colors[key];
                context.fillStyle = hasWarning && color >= 3 ? warningColor : riverColors[color];
                context.fillRect(viewPoint.convertX(x + xOffset), viewPoint.convertY(y), viewPoint.scale, viewPoint.scale);
            }
        }
    }
    static renderProvince(viewPoint, context, province, scale, xOffset = 0, overwriteRenderPrecision) {
        scale = scale !== null && scale !== void 0 ? scale : viewPoint.scale;
        const renderPrecisionBase = 2;
        const renderPrecision = scale < 1 ? Math.pow(2, Math.floor(Math.log2((1 / scale))) + (overwriteRenderPrecision !== undefined ? 0 : renderPrecisionBase)) :
            overwriteRenderPrecision !== null && overwriteRenderPrecision !== void 0 ? overwriteRenderPrecision : (scale <= renderPrecisionBase ? Math.pow(2, renderPrecisionBase + 1 - Math.round(scale)) : 1);
        const renderPrecisionMask = renderPrecision - 1;
        const renderPrecisionOffset = (renderPrecision - 1) / 2;
        for (const zone of province.coverZones) {
            if (zone.w < renderPrecision) {
                if ((zone.x & renderPrecisionMask) === 0 && (zone.y & renderPrecisionMask) === 0) {
                    context.fillRect(viewPoint.convertX(zone.x + xOffset - renderPrecisionOffset), viewPoint.convertY(zone.y - renderPrecisionOffset), renderPrecision * scale, renderPrecision * scale);
                }
            }
            else {
                context.fillRect(viewPoint.convertX(zone.x + xOffset - renderPrecisionOffset), viewPoint.convertY(zone.y - renderPrecisionOffset), zone.w * scale, zone.h * scale);
            }
        }
    }
    renderProvince(context, province, scale, xOffset = 0) {
        Renderer.renderProvince(this.viewPoint, context, province, scale, xOffset);
    }
    registerCanvasEventHandlers() {
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_6__.fromEvent)(this.mainCanvas, 'mousemove').subscribe((e) => {
            this.cursorX = e.pageX;
            this.cursorY = e.pageY;
            this.renderCanvas();
        }));
    }
    renderHoverProvince(province, worldMap, renderAdjacent = true) {
        const backCanvasContext = this.backCanvasContext;
        const viewPoint = this.viewPoint;
        backCanvasContext.fillStyle = 'rgba(255, 255, 255, 0.7)';
        this.renderAllOffsets(province.boundingBox, worldMap.width, xOffset => this.renderProvince(backCanvasContext, province, viewPoint.scale, xOffset));
        if (!renderAdjacent) {
            return;
        }
        for (const adjecent of province.edges) {
            const adjecentNumber = adjecent.to;
            if (adjecentNumber === -1 || adjecent.type === 'impassable') {
                continue;
            }
            const adjecentProvince = worldMap.getProvinceById(adjecentNumber);
            if (adjecentProvince) {
                backCanvasContext.fillStyle = 'rgba(255, 255, 255, 0.3)';
                this.renderAllOffsets(adjecentProvince.boundingBox, worldMap.width, xOffset => this.renderProvince(backCanvasContext, adjecentProvince, viewPoint.scale, xOffset));
            }
        }
    }
    renderSelectedProvince(province, worldMap) {
        this.backCanvasContext.fillStyle = 'rgba(128, 255, 128, 0.7)';
        this.renderAllOffsets(province.boundingBox, worldMap.width, xOffset => this.renderProvince(this.backCanvasContext, province, this.viewPoint.scale, xOffset));
    }
    renderProvinceTooltip(province, worldMap) {
        const stateObject = worldMap.getStateByProvinceId(province.id);
        const strategicRegion = worldMap.getStrategicRegionByProvinceId(province.id);
        const supplyArea = stateObject ? worldMap.getSupplyAreaByStateId(stateObject.id) : undefined;
        const railwayLevel = worldMap.getRailwayLevelByProvinceId(province.id);
        const supplyNode = worldMap.getSupplyNodeByProvinceId(province.id);
        const vp = stateObject === null || stateObject === void 0 ? void 0 : stateObject.victoryPoints[province.id];
        this.renderTooltip(`
${(stateObject === null || stateObject === void 0 ? void 0 : stateObject.impassable) ? '|r|' + (0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.impassable', 'Impassable') : ''}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.province', 'Province')}=${province.id}
${vp ? `${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.victorypoint', 'Victory point')}=${vp}` : ''}
${stateObject ? `
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.state', 'State')}=${stateObject.id}` : ''}
${supplyArea ? `
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.supplyarea', 'Supply area')}=${supplyArea.id}
` : ''}
${railwayLevel ? `
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.railwaylevel', 'Railway level')}=${railwayLevel}
` : ''}
${supplyNode ? `
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.supplynode', 'Supply node')}=true
` : ''}
${strategicRegion ? `
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.strategicregion', 'Strategic region')}=${strategicRegion.id}
` : ''}
${stateObject ? `
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.owner', 'Owner')}=${stateObject.owner}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.coreof', 'Core of')}=${stateObject.cores.join(',')}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.manpower', 'Manpower')}=${toCommaDivideNumber(stateObject.manpower)}` : ''}
${supplyArea ? `
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.supplyvalue', 'Supply value')}=${supplyArea.value}
` : ''}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.type', 'Type')}=${province.type}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.terrain', 'Terrain')}=${province.terrain}
${strategicRegion && strategicRegion.navalTerrain ? `
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.navalterrain', 'Naval terrain')}=${strategicRegion.navalTerrain}
` : ''}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.coastal', 'Coastal')}=${province.coastal}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.continent', 'Continent')}=${province.continent !== 0 ? `${worldMap.continents[province.continent]}(${province.continent})` : '0'}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.adjacencies', 'Adjecencies')}=${province.edges.filter(e => e.type !== 'impassable' && e.to !== -1).map(e => e.to).join(',')}
${worldMap.getProvinceWarnings(province, stateObject, strategicRegion, supplyArea).map(v => '|r|' + v).join('\n')}`);
    }
    renderLoadingText(text) {
        const backCanvasContext = this.backCanvasContext;
        backCanvasContext.font = '12px sans-serif';
        const mesurement = backCanvasContext.measureText(text);
        backCanvasContext.fillStyle = 'black';
        backCanvasContext.fillRect(0, _topbar__WEBPACK_IMPORTED_MODULE_1__.topBarHeight, 20 + mesurement.width, 32);
        backCanvasContext.fillStyle = 'white';
        backCanvasContext.textAlign = 'start';
        backCanvasContext.textBaseline = 'top';
        backCanvasContext.fillText(text, 10, 10 + _topbar__WEBPACK_IMPORTED_MODULE_1__.topBarHeight);
    }
    renderProvinceHoverSelection(worldMap) {
        let province = worldMap.getProvinceById(this.topBar.selectedProvinceId$.value);
        if (province) {
            this.renderSelectedProvince(province, worldMap);
        }
        province = worldMap.getProvinceById(this.topBar.hoverProvinceId$.value);
        if (province) {
            if (this.topBar.selectedProvinceId$ !== this.topBar.hoverProvinceId$ && this.isMouseHighlightVisible()) {
                this.renderHoverProvince(province, worldMap);
            }
            if (this.isTooltipVisible()) {
                this.renderProvinceTooltip(province, worldMap);
            }
        }
    }
    renderStateHoverSelection(worldMap) {
        const hover = worldMap.getStateById(this.topBar.hoverStateId$.value);
        this.renderHoverSelection(worldMap, hover, worldMap.getStateById(this.topBar.selectedStateId$.value));
        hover && this.isTooltipVisible() && this.renderStateTooltip(hover, worldMap);
    }
    renderStrategicRegionHoverSelection(worldMap) {
        const hover = worldMap.getStrategicRegionById(this.topBar.hoverStrategicRegionId$.value);
        this.renderHoverSelection(worldMap, hover, worldMap.getStrategicRegionById(this.topBar.selectedStrategicRegionId$.value));
        hover && this.isTooltipVisible() && this.renderStrategicRegionTooltip(hover, worldMap);
    }
    renderSupplyAreaHoverSelection(worldMap) {
        const hover = worldMap.getSupplyAreaById(this.topBar.hoverSupplyAreaId$.value);
        const selected = worldMap.getSupplyAreaById(this.topBar.selectedSupplyAreaId$.value);
        const toProvinces = (supplyArea) => {
            return supplyArea ?
                {
                    provinces: (0,lodash__WEBPACK_IMPORTED_MODULE_5__.chain)(supplyArea.states)
                        .map(stateId => { var _a; return (_a = worldMap.getStateById(stateId)) === null || _a === void 0 ? void 0 : _a.provinces; })
                        .filter((v) => !!v)
                        .flatten()
                        .value()
                } :
                undefined;
        };
        this.renderHoverSelection(worldMap, toProvinces(hover), toProvinces(selected));
        hover && this.isTooltipVisible() && this.renderSupplyAreaTooltip(hover, worldMap);
    }
    renderHoverSelection(worldMap, hover, selected) {
        if (selected) {
            for (const provinceId of selected.provinces) {
                const province = worldMap.getProvinceById(provinceId);
                if (province) {
                    this.renderSelectedProvince(province, worldMap);
                }
            }
        }
        if (hover && this.isMouseHighlightVisible() && hover !== selected) {
            for (const provinceId of hover.provinces) {
                const province = worldMap.getProvinceById(provinceId);
                if (province) {
                    this.renderHoverProvince(province, worldMap, false);
                }
            }
        }
    }
    renderStateTooltip(state, worldMap) {
        const supplyArea = worldMap.getSupplyAreaByStateId(state.id);
        this.renderTooltip(`
${state.impassable ? '|r|' + (0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.impassable', 'Impassable') : ''}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.state', 'State')}=${state.id}
${supplyArea ? `
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.supplyarea', 'Supply area')}=${supplyArea.id}
` : ''}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.owner', 'Owner')}=${state.owner}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.coreof', 'Core of')}=${state.cores.join(',')}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.manpower', 'Manpower')}=${toCommaDivideNumber(state.manpower)}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.category', 'Category')}=${state.category}
${supplyArea ? `
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.supplyvalue', 'Supply value')}=${supplyArea.value}
` : ''}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.provinces', 'Provinces')}=${state.provinces.join(',')}
${worldMap.getStateWarnings(state, supplyArea).map(v => '|r|' + v).join('\n')}`, (width, height) => {
            const { width: w, height: h } = Renderer.getResourcesSize(state);
            return { width: Math.max(width, w), height: height + h };
        }, (x, y) => {
            Renderer.renderResources(this.backCanvasContext, state, x, y);
        });
    }
    renderStrategicRegionTooltip(strategicRegion, worldMap) {
        this.renderTooltip(`
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.strategicregion', 'Strategic region')}=${strategicRegion.id}
${strategicRegion.navalTerrain ? `
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.navalterrain', 'Naval terrain')}=${strategicRegion.navalTerrain}
` : ''}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.provinces', 'Provinces')}=${strategicRegion.provinces.join(',')}
${worldMap.getStrategicRegionWarnings(strategicRegion).map(v => '|r|' + v).join('\n')}`);
    }
    renderSupplyAreaTooltip(supplyArea, worldMap) {
        this.renderTooltip(`
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.supplyarea', 'Supply area')}=${supplyArea.id}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.supplyvalue', 'Supply value')}=${supplyArea.value}
${(0,_util_i18n__WEBPACK_IMPORTED_MODULE_4__.feLocalize)('worldmap.tooltip.states', 'States')}=${supplyArea.states.join(',')}
${worldMap.getSupplyAreaWarnings(supplyArea).map(v => '|r|' + v).join('\n')}`);
    }
    renderTooltip(tooltip, sizeCallback, renderCallback) {
        var _a;
        const backCanvasContext = this.backCanvasContext;
        const cursorX = this.cursorX;
        const cursorY = this.cursorY;
        let mapX = this.viewPoint.convertBackX(cursorX);
        if (this.loader.worldMap.width > 0 && mapX >= this.loader.worldMap.width) {
            mapX -= this.loader.worldMap.width;
        }
        const mapY = this.viewPoint.convertBackY(cursorY);
        tooltip = `(${mapX}, ${mapY})\nX=${mapX}, Z=${this.loader.worldMap.height - 1 - mapY}\n` + tooltip;
        const colorPrefix = /^\|r\|/;
        const regex = /(\n)|((?:\|r\|)?(?:.{40,59}[, ]|.{60}))/g;
        const text = tooltip.trim()
            .split(regex)
            .map((v, i, a) => {
            if (!(v === null || v === void 0 ? void 0 : v.trim()) || colorPrefix.test(v)) {
                return v;
            }
            for (let j = i - 1; j >= 0; j--) {
                if (!a[j] || a[j] === '\n') {
                    return v;
                }
                const match = colorPrefix.exec(a[j]);
                if (match) {
                    return match[0] + v;
                }
            }
            return v;
        })
            .filter(v => v === null || v === void 0 ? void 0 : v.trim());
        const fontSize = 14;
        let toolTipOffsetX = 10;
        let toolTipOffsetY = 10;
        const marginX = 10;
        const marginY = 10;
        const linePadding = 3;
        backCanvasContext.font = `${fontSize}px sans-serif`;
        backCanvasContext.textAlign = 'start';
        let width = (_a = (0,lodash__WEBPACK_IMPORTED_MODULE_5__.max)(text.map(t => backCanvasContext.measureText(t).width))) !== null && _a !== void 0 ? _a : 0;
        let height = fontSize * text.length + linePadding * (text.length - 1);
        if (cursorX + toolTipOffsetX + width + 2 * marginX > this.canvasWidth) {
            toolTipOffsetX = -10 - (width + 2 * marginX);
        }
        if (cursorY + toolTipOffsetY + height + 2 * marginY > this.canvasHeight) {
            toolTipOffsetY = -10 - (height + 2 * marginY);
        }
        backCanvasContext.strokeStyle = '#7F7F7F';
        backCanvasContext.fillStyle = 'white';
        backCanvasContext.textBaseline = 'top';
        if (sizeCallback) {
            const result = sizeCallback(width, height);
            width = result.width;
            height = result.height;
        }
        backCanvasContext.fillRect(cursorX + toolTipOffsetX, cursorY + toolTipOffsetY, width + 2 * marginX, height + 2 * marginY);
        backCanvasContext.strokeRect(cursorX + toolTipOffsetX, cursorY + toolTipOffsetY, width + 2 * marginX, height + 2 * marginY);
        text.forEach((t, i) => {
            backCanvasContext.fillStyle = 'black';
            if (t.startsWith('|r|')) {
                backCanvasContext.fillStyle = 'red';
                t = t.substring(3);
            }
            t = t.trim();
            backCanvasContext.fillText(t, cursorX + toolTipOffsetX + marginX, cursorY + toolTipOffsetY + marginY + i * (fontSize + linePadding));
        });
        backCanvasContext.fillStyle = 'black';
        if (renderCallback) {
            renderCallback(cursorX + toolTipOffsetX + marginX, cursorY + toolTipOffsetY + marginY + text.length * (fontSize + linePadding));
        }
    }
    static renderAllOffsets(viewPoint, boundingBox, step, callback, minimalRenderCount = 1) {
        let xOffset = 0;
        let i = 0;
        let inView = viewPoint.bboxInView(boundingBox, xOffset);
        while (inView || i < minimalRenderCount) {
            if (inView) {
                callback(xOffset);
            }
            if (step <= 0) {
                return;
            }
            xOffset += step;
            i++;
            inView = viewPoint.bboxInView(boundingBox, xOffset);
        }
    }
    renderAllOffsets(boundingBox, step, callback, minimalRenderCount = 1) {
        Renderer.renderAllOffsets(this.viewPoint, boundingBox, step, callback, minimalRenderCount);
    }
    static getResourcesSize(state, scale = 1, labelWidth = 30) {
        let fullWidth = 0;
        let maxHeight = 0;
        for (const resource in state.resources) {
            if (!state.resources[resource]) {
                continue;
            }
            const image = Renderer.resourceImages[resource];
            if (image) {
                maxHeight = Math.max(maxHeight, image.naturalHeight * scale);
                fullWidth += image.naturalWidth * scale;
            }
            else {
                maxHeight = Math.max(maxHeight, 24 * scale);
                fullWidth += 24 * scale;
            }
            fullWidth += labelWidth;
        }
        return { width: fullWidth, height: maxHeight };
    }
    static renderResources(context, state, x, y, scale = 1, labelWidth = 30) {
        var _a, _b, _c;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        for (const resource in state.resources) {
            const resourceNumber = state.resources[resource];
            if (!resourceNumber) {
                continue;
            }
            const image = Renderer.resourceImages[resource];
            if (image) {
                context.drawImage(image, x, y, image.naturalWidth * scale, image.naturalHeight * scale);
                context.fillText(resourceNumber.toString(), x + ((_a = image === null || image === void 0 ? void 0 : image.naturalWidth) !== null && _a !== void 0 ? _a : 0) * scale + labelWidth / 2, y + Math.max(0, (_b = image === null || image === void 0 ? void 0 : image.naturalHeight) !== null && _b !== void 0 ? _b : 0) * scale / 2);
                x += ((_c = image === null || image === void 0 ? void 0 : image.naturalWidth) !== null && _c !== void 0 ? _c : 0) * scale + labelWidth;
            }
            else {
                context.fillStyle = 'gray';
                context.fillRect(x, y, 24 * scale, 24 * scale);
                context.fillText(resourceNumber.toString(), x + 24 * scale + labelWidth / 2, y + 24 * scale / 2);
                x += 24 * scale + labelWidth;
            }
        }
    }
}
Renderer.resourceImages = {};
function toColor(colorNum) {
    return '#' + (0,lodash__WEBPACK_IMPORTED_MODULE_5__.padStart)(colorNum.toString(16), 6, '0');
}
function findNearestPoints(start, end, a, b) {
    if (start && end) {
        return [start, end];
    }
    if (!b) {
        return [(0,_graphutils__WEBPACK_IMPORTED_MODULE_0__.bboxCenter)(a.boundingBox), (0,_graphutils__WEBPACK_IMPORTED_MODULE_0__.bboxCenter)(a.boundingBox)];
    }
    ;
    if (!start) {
        const t = start, u = a;
        start = end;
        a = b;
        end = t;
        b = u;
    }
    if (!start) {
        let nearestPair = undefined;
        let nearestPairDistance = 1e10;
        for (const ape of a.edges) {
            for (const ap of ape.path) {
                for (const app of ap) {
                    for (const bpe of b.edges) {
                        for (const bp of bpe.path) {
                            for (const bpp of bp) {
                                const disSqr = (0,_graphutils__WEBPACK_IMPORTED_MODULE_0__.distanceSqr)(app, bpp);
                                if (disSqr < nearestPairDistance) {
                                    nearestPairDistance = disSqr;
                                    nearestPair = [app, bpp];
                                }
                            }
                        }
                    }
                }
            }
        }
        return nearestPair !== null && nearestPair !== void 0 ? nearestPair : [(0,_graphutils__WEBPACK_IMPORTED_MODULE_0__.bboxCenter)(a.boundingBox), (0,_graphutils__WEBPACK_IMPORTED_MODULE_0__.bboxCenter)(a.boundingBox)];
    }
    else {
        let nearestPair = undefined;
        let nearestPairDistance = 1e10;
        for (const bpe of b.edges) {
            for (const bp of bpe.path) {
                for (const bpp of bp) {
                    const disSqr = (0,_graphutils__WEBPACK_IMPORTED_MODULE_0__.distanceSqr)(start, bpp);
                    if (disSqr < nearestPairDistance) {
                        nearestPairDistance = disSqr;
                        nearestPair = [start, bpp];
                    }
                }
            }
        }
        return nearestPair !== null && nearestPair !== void 0 ? nearestPair : [(0,_graphutils__WEBPACK_IMPORTED_MODULE_0__.bboxCenter)(a.boundingBox), (0,_graphutils__WEBPACK_IMPORTED_MODULE_0__.bboxCenter)(a.boundingBox)];
    }
}
function getColorByColorSet(colorSet, province, worldMap, renderContext) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const { provinceToState, provinceToStrategicRegion, stateToSupplyArea, topBar } = renderContext;
    switch (colorSet) {
        case 'provincetype':
            return (province.type === 'land' ? 0x007F00 : province.type === 'lake' ? 0x00FFFF : 0x00007F) | (province.coastal ? 0x7F0000 : 0);
        case 'country':
            {
                const stateId = provinceToState[province.id];
                return (_b = (_a = worldMap.countries.find(c => { var _a; return c && c.tag === ((_a = worldMap.getStateById(stateId)) === null || _a === void 0 ? void 0 : _a.owner); })) === null || _a === void 0 ? void 0 : _a.color) !== null && _b !== void 0 ? _b : defaultColor(province);
            }
        case 'terrain':
            {
                if (renderContext.extraState === undefined) {
                    renderContext.extraState = (0,_util_common__WEBPACK_IMPORTED_MODULE_3__.arrayToMap)(worldMap.terrains, 'name');
                }
                const navalTerrain = province.type === 'land' ? undefined : (_c = worldMap.getStrategicRegionById(provinceToStrategicRegion[province.id])) === null || _c === void 0 ? void 0 : _c.navalTerrain;
                return (_e = (_d = renderContext.extraState[navalTerrain !== null && navalTerrain !== void 0 ? navalTerrain : province.terrain]) === null || _d === void 0 ? void 0 : _d.color) !== null && _e !== void 0 ? _e : 0;
            }
        case 'continent':
            if (renderContext.extraState === undefined) {
                let continent = 0;
                worldMap.forEachProvince(p => (p.continent > continent ? continent = p.continent : 0, false));
                renderContext.extraState = avoidPowerOf2(continent + 1);
            }
            return province.continent !== 0 ? valueAndMaxToColor(province.continent + 1, renderContext.extraState) : defaultColor(province);
        case 'stateid':
            {
                if (renderContext.extraState === undefined) {
                    renderContext.extraState = avoidPowerOf2(worldMap.statesCount);
                }
                const stateId = provinceToState[province.id];
                return stateId !== undefined ? valueAndMaxToColor(stateId < 0 ? 0 : stateId, renderContext.extraState) : defaultColor(province);
            }
        case 'warnings':
            {
                const isLand = province.type === 'land';
                const viewMode = topBar.viewMode$.value;
                const warningFilter = topBar.warningFilter.selectedValues$.value;
                const stateId = provinceToState[province.id];
                const state = worldMap.getStateById(stateId);
                const strategicRegion = worldMap.getStrategicRegionById(provinceToStrategicRegion[province.id]);
                const supplyAreaId = stateId ? stateToSupplyArea[stateId] : undefined;
                const supplyArea = worldMap.getSupplyAreaById(supplyAreaId);
                return worldMap.getProvinceWarnings(viewMode !== "warnings" || warningFilter.includes('province') ? province : undefined, viewMode !== "warnings" || warningFilter.includes('state') ? state : undefined, viewMode !== "warnings" || warningFilter.includes('strategicregion') ? strategicRegion : undefined, viewMode !== "warnings" || warningFilter.includes('supplyarea') ? supplyArea : undefined).length > 0 ?
                    (isLand ? landWarning : waterWarning) :
                    (isLand ? landNoWarning : waterNoWarning);
            }
        case 'manpower':
            {
                if (province.type === 'sea') {
                    return defaultColor(province);
                }
                if (renderContext.extraState === undefined) {
                    let maxManpower = 0;
                    worldMap.forEachState(state => (state.manpower > maxManpower ? maxManpower = state.manpower : 0, false));
                    renderContext.extraState = maxManpower;
                }
                const stateId = provinceToState[province.id];
                const state = worldMap.getStateById(stateId);
                const value = manpowerHandler((_f = state === null || state === void 0 ? void 0 : state.manpower) !== null && _f !== void 0 ? _f : 0) / manpowerHandler(renderContext.extraState);
                return valueToColorGYR(value);
            }
        case 'victorypoint':
            {
                if (renderContext.extraState === undefined) {
                    let maxVictoryPoint = 0;
                    worldMap.forEachState(state => Object.values(state.victoryPoints).forEach(vp => vp !== undefined && vp > maxVictoryPoint ? maxVictoryPoint = vp : 0));
                    renderContext.extraState = maxVictoryPoint;
                }
                const stateId = provinceToState[province.id];
                const state = worldMap.getStateById(stateId);
                const value = victoryPointsHandler(state ? (_g = state.victoryPoints[province.id]) !== null && _g !== void 0 ? _g : 0.1 : 0) / victoryPointsHandler(renderContext.extraState);
                return valueToColorGreyScale(value);
            }
        case 'resources':
            {
                if (province.type === 'sea') {
                    return defaultColor(province);
                }
                if (renderContext.extraState === undefined) {
                    let maxResources = 0;
                    worldMap.forEachState(state => {
                        const numResources = Object.values(state.resources).reduce((p, c) => p + (c !== null && c !== void 0 ? c : 0), 0);
                        if (numResources > maxResources) {
                            maxResources = numResources;
                        }
                        return false;
                    });
                    renderContext.extraState = maxResources;
                }
                const stateId = provinceToState[province.id];
                const state = worldMap.getStateById(stateId);
                const numResources = state ? Object.values(state.resources).reduce((p, c) => p + (c !== null && c !== void 0 ? c : 0), 0) : 0;
                const value = resourcesHandler(numResources) / resourcesHandler(renderContext.extraState);
                return valueToColorGYR(value);
            }
        case 'strategicregionid':
            {
                if (renderContext.extraState === undefined) {
                    renderContext.extraState = avoidPowerOf2(worldMap.strategicRegionsCount);
                }
                const strategicRegionId = provinceToStrategicRegion[province.id];
                return valueAndMaxToColor(strategicRegionId === undefined || strategicRegionId < 0 ? 0 : strategicRegionId, renderContext.extraState);
            }
        case 'supplyareaid':
            {
                if (renderContext.extraState === undefined) {
                    renderContext.extraState = avoidPowerOf2(worldMap.supplyAreasCount);
                }
                const stateId = provinceToState[province.id];
                const supplyAreaId = stateId !== undefined ? stateToSupplyArea[stateId] : undefined;
                return supplyAreaId !== undefined ? valueAndMaxToColor(supplyAreaId < 0 ? 0 : supplyAreaId, renderContext.extraState) : defaultColor(province);
            }
        case 'supplyvalue':
            {
                if (province.type === 'sea') {
                    return defaultColor(province);
                }
                if (renderContext.extraState === undefined) {
                    let maxSupplyValue = 0;
                    worldMap.forEachSupplyArea(supplyArea => (supplyArea.value > maxSupplyValue ? maxSupplyValue = supplyArea.value : 0, false));
                    renderContext.extraState = maxSupplyValue;
                }
                const stateId = provinceToState[province.id];
                const supplyAreaId = stateId ? stateToSupplyArea[stateId] : undefined;
                const supplyArea = worldMap.getSupplyAreaById(supplyAreaId);
                const value = ((_h = supplyArea === null || supplyArea === void 0 ? void 0 : supplyArea.value) !== null && _h !== void 0 ? _h : 0) / (renderContext.extraState);
                return valueToColorGYR(value);
            }
        default:
            return province.color;
    }
}
function manpowerHandler(manpower) {
    if (manpower < 0) {
        manpower = 0;
    }
    return Math.pow(manpower, 0.2);
}
function victoryPointsHandler(victoryPoints) {
    if (victoryPoints < 0) {
        victoryPoints = 0;
    }
    return Math.pow(victoryPoints, 0.5);
}
function resourcesHandler(resources) {
    if (resources < 0) {
        resources = 0;
    }
    return Math.pow(resources, 0.2);
}
function valueToColorRYG(value) {
    return value < 0.5 ? (0xFF0000 | (Math.floor(255 * 2 * value) << 8)) : (0xFF00 | (Math.floor(255 * 2 * (1 - value)) << 16));
}
function valueToColorGYR(value) {
    return value < 0.5 ? (0xFF00 | (Math.floor(255 * 2 * value) << 16)) : (0xFF0000 | (Math.floor(255 * 2 * (1 - value)) << 8));
}
function valueToColorBCG(value) {
    return value < 0.5 ? (0xFF | (Math.floor(255 * 2 * value) << 8)) : (0xFF00 | Math.floor(255 * 2 * (1 - value)));
}
function valueToColorGreyScale(value) {
    return Math.floor(value * 255) * 0x10101;
}
function valueAndMaxToColor(value, max) {
    return Math.floor(value * (0xFFFFFF / max));
}
function getHighConstrastColor(color) {
    const r = (color >> 16) & 0xFF;
    const g = (color >> 8) & 0xFF;
    const b = color & 0xFF;
    return r * 0.7 + g * 2 + b * 0.3 > 3 * 0x7F ? 0 : 0xFFFFFF;
}
function avoidPowerOf2(value) {
    const v = Math.log2(value);
    if (v > 0 && (v >>> 0) === v) {
        return value + 1;
    }
    return value;
}
function isCriticalPoint(path, index) {
    return index === 0 || index === path.length - 1 ||
        ((0,_graphutils__WEBPACK_IMPORTED_MODULE_0__.distanceHamming)(path[index], path[index - 1]) > 2 && (0,_graphutils__WEBPACK_IMPORTED_MODULE_0__.distanceHamming)(path[index], path[index + 1]) > 2);
}
function defaultColor(province) {
    return province.type === 'land' ? 0 : 0x1010B0;
}
function toCommaDivideNumber(value) {
    return value.toString(10).replace(/(?<!^)(\d{3})(?=(?:\d{3})*$)/g, ',$1');
}


/***/ }),

/***/ "./webviewsrc/worldmap/topbar.ts":
/*!***************************************!*\
  !*** ./webviewsrc/worldmap/topbar.ts ***!
  \***************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   TopBar: () => (/* binding */ TopBar),
/* harmony export */   topBarHeight: () => (/* binding */ topBarHeight)
/* harmony export */ });
/* harmony import */ var _util_event__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../util/event */ "./webviewsrc/util/event.ts");
/* harmony import */ var _viewpoint__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./viewpoint */ "./webviewsrc/worldmap/viewpoint.ts");
/* harmony import */ var _util_vscode__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../util/vscode */ "./webviewsrc/util/vscode.ts");
/* harmony import */ var _util_i18n__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! ../util/i18n */ "./webviewsrc/util/i18n.ts");
/* harmony import */ var _util_dropdown__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! ../util/dropdown */ "./webviewsrc/util/dropdown.ts");
/* harmony import */ var rxjs__WEBPACK_IMPORTED_MODULE_7__ = __webpack_require__(/*! rxjs */ "./node_modules/rxjs/_esm5/internal/BehaviorSubject.js");
/* harmony import */ var rxjs__WEBPACK_IMPORTED_MODULE_8__ = __webpack_require__(/*! rxjs */ "./node_modules/rxjs/_esm5/internal/observable/fromEvent.js");
/* harmony import */ var rxjs__WEBPACK_IMPORTED_MODULE_9__ = __webpack_require__(/*! rxjs */ "./node_modules/rxjs/_esm5/internal/observable/combineLatest.js");
/* harmony import */ var _renderer__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! ./renderer */ "./webviewsrc/worldmap/renderer.ts");
/* harmony import */ var _util_telemetry__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! ../util/telemetry */ "./webviewsrc/util/telemetry.ts");








const topBarHeight = 40;
class TopBar extends _util_event__WEBPACK_IMPORTED_MODULE_0__.Subscriber {
    constructor(canvas, viewPoint, loader, state) {
        var _a, _b, _c, _d, _e, _f;
        super();
        this.viewPoint = viewPoint;
        this.loader = loader;
        this.warningsVisible = false;
        this.addSubscription(this.warningFilter = new _util_dropdown__WEBPACK_IMPORTED_MODULE_4__.DivDropdown(document.getElementById('warningfilter'), true));
        this.addSubscription(this.display = new _util_dropdown__WEBPACK_IMPORTED_MODULE_4__.DivDropdown(document.getElementById('display'), true));
        this.viewMode$ = (0,_util_event__WEBPACK_IMPORTED_MODULE_0__.toBehaviorSubject)(document.getElementById('viewmode'), (_a = state.viewMode) !== null && _a !== void 0 ? _a : 'province');
        this.colorSet$ = (0,_util_event__WEBPACK_IMPORTED_MODULE_0__.toBehaviorSubject)(document.getElementById('colorset'), (_b = state.colorSet) !== null && _b !== void 0 ? _b : 'provinceid');
        this.hoverProvinceId$ = new rxjs__WEBPACK_IMPORTED_MODULE_7__.BehaviorSubject(undefined);
        this.selectedProvinceId$ = new rxjs__WEBPACK_IMPORTED_MODULE_7__.BehaviorSubject((_c = state.selectedProvinceId) !== null && _c !== void 0 ? _c : undefined);
        this.hoverStateId$ = new rxjs__WEBPACK_IMPORTED_MODULE_7__.BehaviorSubject(undefined);
        this.selectedStateId$ = new rxjs__WEBPACK_IMPORTED_MODULE_7__.BehaviorSubject((_d = state.selectedStateId) !== null && _d !== void 0 ? _d : undefined);
        this.hoverStrategicRegionId$ = new rxjs__WEBPACK_IMPORTED_MODULE_7__.BehaviorSubject(undefined);
        this.selectedStrategicRegionId$ = new rxjs__WEBPACK_IMPORTED_MODULE_7__.BehaviorSubject((_e = state.selectedStrategicRegionId) !== null && _e !== void 0 ? _e : undefined);
        this.hoverSupplyAreaId$ = new rxjs__WEBPACK_IMPORTED_MODULE_7__.BehaviorSubject(undefined);
        this.selectedSupplyAreaId$ = new rxjs__WEBPACK_IMPORTED_MODULE_7__.BehaviorSubject((_f = state.selectedSupplyAreaId) !== null && _f !== void 0 ? _f : undefined);
        if (state.warningFilter) {
            this.warningFilter.selectedValues$.next(state.warningFilter);
        }
        else {
            this.warningFilter.selectAll();
        }
        if (state.display) {
            this.display.selectedValues$.next(state.display);
        }
        else {
            this.display.selectAll();
        }
        this.searchBox = document.getElementById("searchbox");
        this.loadControls();
        this.registerEventListeners(canvas);
    }
    onViewModeChange() {
        var _a;
        document.querySelectorAll('#colorset > option[viewmode]').forEach(v => {
            v.hidden = true;
        });
        let colorSetHidden = true;
        document.querySelectorAll('#colorset > option[viewmode~="' + this.viewMode$.value + '"]').forEach(v => {
            v.hidden = false;
            if (v.value === this.colorSet$.value) {
                colorSetHidden = false;
            }
        });
        document.querySelectorAll('#colorset > option:not([viewmode])').forEach(v => {
            if (v.value === this.colorSet$.value) {
                colorSetHidden = false;
            }
        });
        document.querySelectorAll('button[viewmode]').forEach(v => {
            v.style.display = 'none';
        });
        document.querySelectorAll('button[viewmode~="' + this.viewMode$.value + '"]').forEach(v => {
            v.style.display = 'inline-block';
        });
        document.querySelectorAll('.group[viewmode]').forEach(v => {
            v.style.display = 'none';
        });
        document.querySelectorAll('.group[viewmode~="' + this.viewMode$.value + '"]').forEach(v => {
            v.style.display = 'inline-block';
        });
        if (colorSetHidden) {
            const newColorset = (_a = document.querySelector('#colorset > option:not(*[hidden])')) === null || _a === void 0 ? void 0 : _a.value;
            this.colorSet$.next(newColorset);
        }
        this.setSearchBoxPlaceHolder();
    }
    loadControls() {
        this.loadWarningButton();
        this.loadSearchBox();
        this.loadRefreshButton();
        this.loadOpenButton();
        this.loadExportButton();
    }
    loadWarningButton() {
        const warningsContainer = document.getElementById('warnings-container');
        const showWarnings = document.getElementById('show-warnings');
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_8__.fromEvent)(showWarnings, 'click').subscribe(() => {
            this.warningsVisible = !this.warningsVisible;
            if (this.warningsVisible) {
                (0,_util_telemetry__WEBPACK_IMPORTED_MODULE_6__.sendEvent)('worldmap.openwarnings');
                warningsContainer.style.display = 'block';
            }
            else {
                warningsContainer.style.display = 'none';
            }
        }));
    }
    loadSearchBox() {
        const searchBox = this.searchBox;
        const search = document.getElementById("search");
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_8__.fromEvent)(searchBox, 'keypress').subscribe((e) => {
            if (e.code === 'Enter') {
                (0,_util_telemetry__WEBPACK_IMPORTED_MODULE_6__.sendEvent)('worldmap.search', { keypress: 'true' });
                this.search(searchBox.value);
            }
        }));
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_8__.fromEvent)(search, 'click').subscribe(() => {
            (0,_util_telemetry__WEBPACK_IMPORTED_MODULE_6__.sendEvent)('worldmap.search', { keypress: 'false' });
            this.search(searchBox.value);
        }));
    }
    loadRefreshButton() {
        const refresh = document.getElementById("refresh");
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_8__.fromEvent)(refresh, 'click').subscribe(() => {
            if (!refresh.disabled) {
                (0,_util_telemetry__WEBPACK_IMPORTED_MODULE_6__.sendEvent)('worldmap.refresh');
                this.loader.refresh();
            }
        }));
        this.addSubscription(this.loader.loading$.subscribe(v => {
            refresh.disabled = v;
        }));
    }
    openMapItem(useHoverValue = false) {
        var _a, _b, _c, _d, _e, _f;
        (0,_util_telemetry__WEBPACK_IMPORTED_MODULE_6__.sendEvent)('worldmap.open.' + this.viewMode$.value + (useHoverValue ? '.dblclick' : ''));
        if (this.viewMode$.value === 'state') {
            const selected = useHoverValue ? this.hoverStateId$.value : this.selectedStateId$.value;
            if (selected) {
                const state = this.loader.worldMap.getStateById(selected);
                if (state) {
                    _util_vscode__WEBPACK_IMPORTED_MODULE_2__.vscode.postMessage({ command: 'openfile', type: 'state', file: state.file, start: (_a = state.token) === null || _a === void 0 ? void 0 : _a.start, end: (_b = state.token) === null || _b === void 0 ? void 0 : _b.end });
                }
            }
        }
        else if (this.viewMode$.value === 'strategicregion') {
            const selected = useHoverValue ? this.hoverStrategicRegionId$.value : this.selectedStrategicRegionId$.value;
            if (selected) {
                const strategicRegion = this.loader.worldMap.getStrategicRegionById(selected);
                if (strategicRegion) {
                    _util_vscode__WEBPACK_IMPORTED_MODULE_2__.vscode.postMessage({ command: 'openfile', type: 'strategicregion', file: strategicRegion.file,
                        start: (_c = strategicRegion.token) === null || _c === void 0 ? void 0 : _c.start, end: (_d = strategicRegion.token) === null || _d === void 0 ? void 0 : _d.end });
                }
            }
        }
        else if (this.viewMode$.value === 'supplyarea') {
            const selected = useHoverValue ? this.hoverSupplyAreaId$.value : this.selectedSupplyAreaId$.value;
            if (selected) {
                const supplyArea = this.loader.worldMap.getSupplyAreaById(selected);
                if (supplyArea) {
                    _util_vscode__WEBPACK_IMPORTED_MODULE_2__.vscode.postMessage({ command: 'openfile', type: 'supplyarea', file: supplyArea.file,
                        start: (_e = supplyArea.token) === null || _e === void 0 ? void 0 : _e.start, end: (_f = supplyArea.token) === null || _f === void 0 ? void 0 : _f.end });
                }
            }
        }
    }
    loadOpenButton() {
        const open = document.getElementById("open");
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_8__.fromEvent)(open, 'click').subscribe((e) => {
            e.stopPropagation();
            this.openMapItem();
        }));
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_9__.combineLatest)([this.viewMode$, this.selectedStateId$, this.selectedStrategicRegionId$, this.selectedSupplyAreaId$]).subscribe(([viewMode, selectedStateId, selectedStrategicRegionId, selectedSupplyAreaId]) => {
            open.disabled = !((viewMode === 'state' && selectedStateId !== undefined) ||
                (viewMode === 'strategicregion' && selectedStrategicRegionId !== undefined) ||
                (viewMode === 'supplyarea' && selectedSupplyAreaId !== undefined));
        }));
    }
    loadExportButton() {
        const exportButton = document.getElementById("export");
        exportButton.disabled = true;
        this.addSubscription(this.loader.worldMap$.subscribe(wm => {
            exportButton.disabled = !wm;
        }));
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_8__.fromEvent)(exportButton, 'click').subscribe(e => {
            e.stopPropagation();
            _util_vscode__WEBPACK_IMPORTED_MODULE_2__.vscode.postMessage({ command: 'requestexportmap' });
        }));
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_8__.fromEvent)(window, 'message').subscribe(event => {
            const message = event.data;
            if (message.command !== 'requestexportmap') {
                return;
            }
            const worldMap = this.loader.worldMap;
            if (!worldMap) {
                return;
            }
            (0,_util_telemetry__WEBPACK_IMPORTED_MODULE_6__.sendEvent)('worldmap.export');
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, worldMap.width);
            canvas.height = Math.max(1, worldMap.height);
            const viewPoint = new _viewpoint__WEBPACK_IMPORTED_MODULE_1__.ViewPoint(canvas, this.loader, 0, { x: 0, y: 0, scale: 1 });
            _renderer__WEBPACK_IMPORTED_MODULE_5__.Renderer.renderMapImpl(canvas, this, viewPoint, worldMap, { preciseEdge: true, overwriteRenderPrecision: 1 });
            _util_vscode__WEBPACK_IMPORTED_MODULE_2__.vscode.postMessage({ command: 'exportmap', dataUrl: canvas.toDataURL() });
        }));
    }
    registerEventListeners(canvas) {
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_8__.fromEvent)(canvas, 'mousemove').subscribe((e) => {
            var _a, _b, _c, _d;
            if (!this.loader.worldMap) {
                this.hoverProvinceId$.next(undefined);
                this.hoverStateId$.next(undefined);
                this.hoverStrategicRegionId$.next(undefined);
                this.hoverSupplyAreaId$.next(undefined);
                return;
            }
            const worldMap = this.loader.worldMap;
            let x = this.viewPoint.convertBackX(e.pageX);
            let y = this.viewPoint.convertBackY(e.pageY);
            if (x < 0) {
                x += worldMap.width;
            }
            while (x >= worldMap.width && worldMap.width > 0) {
                x -= worldMap.width;
            }
            this.hoverProvinceId$.next((_a = worldMap.getProvinceByPosition(x, y)) === null || _a === void 0 ? void 0 : _a.id);
            this.hoverStateId$.next(this.hoverProvinceId$.value === undefined ? undefined : (_b = worldMap.getStateByProvinceId(this.hoverProvinceId$.value)) === null || _b === void 0 ? void 0 : _b.id);
            this.hoverStrategicRegionId$.next(this.hoverProvinceId$.value === undefined ? undefined : (_c = worldMap.getStrategicRegionByProvinceId(this.hoverProvinceId$.value)) === null || _c === void 0 ? void 0 : _c.id);
            this.hoverSupplyAreaId$.next(this.hoverStateId$.value === undefined ? undefined : (_d = worldMap.getSupplyAreaByStateId(this.hoverStateId$.value)) === null || _d === void 0 ? void 0 : _d.id);
        }));
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_8__.fromEvent)(canvas, 'mouseleave').subscribe(() => {
            this.hoverProvinceId$.next(undefined);
            this.hoverStateId$.next(undefined);
            this.hoverStrategicRegionId$.next(undefined);
            this.hoverSupplyAreaId$.next(undefined);
        }));
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_8__.fromEvent)(canvas, 'click').subscribe(() => {
            switch (this.viewMode$.value) {
                case 'province':
                    this.selectedProvinceId$.next(this.selectedProvinceId$.value === this.hoverProvinceId$.value ? undefined : this.hoverProvinceId$.value);
                    break;
                case 'state':
                    this.selectedStateId$.next(this.selectedStateId$.value === this.hoverStateId$.value ? undefined : this.hoverStateId$.value);
                    break;
                case 'strategicregion':
                    this.selectedStrategicRegionId$.next(this.selectedStrategicRegionId$.value === this.hoverStrategicRegionId$.value ? undefined : this.hoverStrategicRegionId$.value);
                    break;
                case 'supplyarea':
                    this.selectedSupplyAreaId$.next(this.selectedSupplyAreaId$.value === this.hoverSupplyAreaId$.value ? undefined : this.hoverSupplyAreaId$.value);
                    break;
            }
        }));
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_8__.fromEvent)(canvas, 'dblclick').subscribe(e => {
            e.stopPropagation();
            this.openMapItem(true);
        }));
        this.addSubscription(this.viewMode$.subscribe(() => this.onViewModeChange()));
        this.addSubscription(this.loader.worldMap$.subscribe(wm => {
            const warnings = document.getElementById('warnings');
            if (wm.warnings.length === 0) {
                warnings.value = (0,_util_i18n__WEBPACK_IMPORTED_MODULE_3__.feLocalize)('worldmap.warnings.nowarnings', 'No warnings.');
            }
            else {
                warnings.value = (0,_util_i18n__WEBPACK_IMPORTED_MODULE_3__.feLocalize)('worldmap.warnings', 'World map warnings: \n\n{0}', wm.warnings.map(warningToString).join('\n'));
            }
            this.setSearchBoxPlaceHolder(wm);
        }));
    }
    search(text) {
        const number = parseInt(text);
        if (isNaN(number)) {
            return;
        }
        const viewMode = this.viewMode$.value;
        const [getRegionById, selectedId] = viewMode === 'province' ? [this.loader.worldMap.getProvinceById, this.selectedProvinceId$] :
            viewMode === 'state' ? [this.loader.worldMap.getStateById, this.selectedStateId$] :
                viewMode === 'strategicregion' ? [this.loader.worldMap.getStrategicRegionById, this.selectedStrategicRegionId$] :
                    viewMode === 'supplyarea' ? [this.loader.worldMap.getSupplyAreaById, this.selectedSupplyAreaId$] :
                        [() => undefined, undefined];
        const region = getRegionById(number);
        if (region) {
            selectedId === null || selectedId === void 0 ? void 0 : selectedId.next(number);
            this.viewPoint.centerZone(region.boundingBox);
        }
    }
    setSearchBoxPlaceHolder(worldMap) {
        if (!worldMap) {
            worldMap = this.loader.worldMap;
        }
        let placeholder = '';
        switch (this.viewMode$.value) {
            case 'province':
                placeholder = worldMap.provincesCount > 1 ? `1-${worldMap.provincesCount - 1}` : '';
                break;
            case 'state':
                placeholder = worldMap.statesCount > 1 ? `1-${worldMap.statesCount - 1}` : '';
                break;
            case 'strategicregion':
                placeholder = worldMap.strategicRegionsCount > 1 ? `1-${worldMap.strategicRegionsCount - 1}` : '';
                break;
            case 'supplyarea':
                placeholder = worldMap.supplyAreasCount > 1 ? `1-${worldMap.supplyAreasCount - 1}` : '';
                break;
            default:
                break;
        }
        if (placeholder) {
            this.searchBox.placeholder = (0,_util_i18n__WEBPACK_IMPORTED_MODULE_3__.feLocalize)('worldmap.topbar.search.placeholder', 'Range: {0}', placeholder);
        }
        else {
            this.searchBox.placeholder = '';
        }
    }
}
function warningToString(warning) {
    return `[${warning.source.map(s => `${s.type[0].toUpperCase()}${s.type.substr(1)} ${'id' in s ? s.id : s.name}`).join(', ')}] ${warning.text}`;
}


/***/ }),

/***/ "./webviewsrc/worldmap/viewpoint.ts":
/*!******************************************!*\
  !*** ./webviewsrc/worldmap/viewpoint.ts ***!
  \******************************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

__webpack_require__.r(__webpack_exports__);
/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   ViewPoint: () => (/* binding */ ViewPoint)
/* harmony export */ });
/* harmony import */ var _util_event__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../util/event */ "./webviewsrc/util/event.ts");
/* harmony import */ var _graphutils__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./graphutils */ "./webviewsrc/worldmap/graphutils.ts");
/* harmony import */ var rxjs__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! rxjs */ "./node_modules/rxjs/_esm5/internal/BehaviorSubject.js");
/* harmony import */ var rxjs__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! rxjs */ "./node_modules/rxjs/_esm5/internal/observable/fromEvent.js");



class ViewPoint extends _util_event__WEBPACK_IMPORTED_MODULE_0__.Subscriber {
    constructor(canvas, loader, topBarHeight, viewPointObj) {
        super();
        this.canvas = canvas;
        this.loader = loader;
        this.topBarHeight = topBarHeight;
        this.x = viewPointObj.x;
        this.y = viewPointObj.y;
        this.scale = viewPointObj.scale;
        this.observable$ = new rxjs__WEBPACK_IMPORTED_MODULE_2__.BehaviorSubject(viewPointObj);
        this.enableDragger();
    }
    convertX(x) {
        return Math.round((x - this.x) * this.scale);
    }
    convertY(y) {
        return Math.round((y - this.y) * this.scale);
    }
    convertBackX(x) {
        return Math.floor(x / this.scale + this.x);
    }
    convertBackY(y) {
        return Math.floor(y / this.scale + this.y);
    }
    bboxInView(bbox, xoffset) {
        const r = this.x + this.canvas.width / this.scale;
        const b = this.y + this.canvas.height / this.scale;
        const br = bbox.x + bbox.w;
        const bb = bbox.y + bbox.h;
        return r > bbox.x + xoffset && br + xoffset > this.x && b > bbox.y && bb > this.y;
    }
    lineInView(start, end, xoffset) {
        const r = this.x + this.canvas.width / this.scale;
        const b = this.y + this.canvas.height / this.scale;
        if (start.x > end.x) {
            const t = start;
            start = end;
            end = t;
        }
        if (start.x >= r || end.x <= this.x) {
            return false;
        }
        const k = (end.y - start.y) / (end.x - start.x);
        const y1 = k * (this.x - start.x - xoffset) + start.y;
        const y2 = k * (r - start.x - xoffset) + start.y;
        return (y1 > this.y && y1 < b) || (y2 > this.y && y2 < b) ||
            (y1 < b && y2 > this.y) || (y1 > this.y && y2 < b);
    }
    centerZone(zone) {
        const expectedScale = Math.min(this.canvas.width / zone.w / 2, this.canvas.height / zone.h / 2);
        if (expectedScale < 1) {
            this.scale = Math.pow(2, Math.max(-2, Math.round(Math.log2(expectedScale))));
        }
        else {
            this.scale = Math.round(Math.min(12, expectedScale));
        }
        this.centerPoint((0,_graphutils__WEBPACK_IMPORTED_MODULE_1__.bboxCenter)(zone));
    }
    centerPoint(point) {
        this.x = point.x - this.canvas.width / 2 / this.scale;
        this.y = point.y - this.canvas.height / 2 / this.scale;
        this.alignViewPointXY();
        this.updateObservable();
    }
    toJson() {
        return {
            x: this.x,
            y: this.y,
            scale: this.scale,
        };
    }
    enableDragger() {
        let mdx = -1;
        let mdy = -1;
        let pressed = false;
        let vpx = -1;
        let vpy = -1;
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_3__.fromEvent)(this.canvas, 'mousedown').subscribe((e) => {
            if (!this.loader.worldMap || !(e.buttons & 2)) {
                return;
            }
            mdx = e.pageX;
            mdy = e.pageY;
            vpx = this.x;
            vpy = this.y;
            pressed = true;
        }));
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_3__.fromEvent)(document.body, 'mousemove').subscribe((e) => {
            if (!this.loader.worldMap) {
                pressed = false;
            }
            if (pressed) {
                this.x = vpx - (e.pageX - mdx) / this.scale;
                this.y = vpy - (e.pageY - mdy) / this.scale;
                this.alignViewPointXY();
                this.updateObservable();
            }
        }));
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_3__.fromEvent)(document.body, 'mouseup').subscribe(() => {
            pressed = false;
        }));
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_3__.fromEvent)(document.body, 'mouseenter').subscribe((e) => {
            if (pressed && (e.buttons & 2) !== 2) {
                pressed = false;
            }
        }));
        this.addSubscription((0,rxjs__WEBPACK_IMPORTED_MODULE_3__.fromEvent)(this.canvas, 'wheel').subscribe((e) => {
            this.x += e.pageX / this.scale;
            this.y += e.pageY / this.scale;
            if (e.deltaY > 0) {
                if (this.scale <= 1) {
                    if (this.scale > 0.25) {
                        this.scale /= 2;
                    }
                }
                else {
                    this.scale = Math.max(1, this.scale - 1);
                }
            }
            else if (e.deltaY < 0) {
                if (this.scale < 1) {
                    this.scale *= 2;
                }
                else {
                    this.scale = Math.min(16, Math.floor(this.scale + 1));
                }
            }
            this.x -= e.pageX / this.scale;
            this.y -= e.pageY / this.scale;
            this.alignViewPointXY();
            this.updateObservable();
        }));
    }
    alignViewPointXY() {
        if (!this.loader.worldMap) {
            return;
        }
        if (this.loader.worldMap.width === 0) {
            this.x = 0;
        }
        else {
            while (this.x < 0) {
                this.x += this.loader.worldMap.width;
            }
            while (this.x > this.loader.worldMap.width) {
                this.x -= this.loader.worldMap.width;
            }
        }
        const minY = -this.topBarHeight / this.scale;
        const maxY = this.loader.worldMap.height - this.canvas.height / this.scale;
        if (maxY < minY || this.y < minY) {
            this.y = minY;
        }
        else if (this.y > maxY) {
            this.y = maxY;
        }
    }
    updateObservable() {
        this.observable$.next(this.toJson());
    }
}


/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			id: moduleId,
/******/ 			loaded: false,
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId].call(module.exports, module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = __webpack_modules__;
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/chunk loaded */
/******/ 	(() => {
/******/ 		var deferred = [];
/******/ 		__webpack_require__.O = (result, chunkIds, fn, priority) => {
/******/ 			if(chunkIds) {
/******/ 				priority = priority || 0;
/******/ 				for(var i = deferred.length; i > 0 && deferred[i - 1][2] > priority; i--) deferred[i] = deferred[i - 1];
/******/ 				deferred[i] = [chunkIds, fn, priority];
/******/ 				return;
/******/ 			}
/******/ 			var notFulfilled = Infinity;
/******/ 			for (var i = 0; i < deferred.length; i++) {
/******/ 				var [chunkIds, fn, priority] = deferred[i];
/******/ 				var fulfilled = true;
/******/ 				for (var j = 0; j < chunkIds.length; j++) {
/******/ 					if ((priority & 1 === 0 || notFulfilled >= priority) && Object.keys(__webpack_require__.O).every((key) => (__webpack_require__.O[key](chunkIds[j])))) {
/******/ 						chunkIds.splice(j--, 1);
/******/ 					} else {
/******/ 						fulfilled = false;
/******/ 						if(priority < notFulfilled) notFulfilled = priority;
/******/ 					}
/******/ 				}
/******/ 				if(fulfilled) {
/******/ 					deferred.splice(i--, 1)
/******/ 					var r = fn();
/******/ 					if (r !== undefined) result = r;
/******/ 				}
/******/ 			}
/******/ 			return result;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/global */
/******/ 	(() => {
/******/ 		__webpack_require__.g = (function() {
/******/ 			if (typeof globalThis === 'object') return globalThis;
/******/ 			try {
/******/ 				return this || new Function('return this')();
/******/ 			} catch (e) {
/******/ 				if (typeof window === 'object') return window;
/******/ 			}
/******/ 		})();
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/node module decorator */
/******/ 	(() => {
/******/ 		__webpack_require__.nmd = (module) => {
/******/ 			module.paths = [];
/******/ 			if (!module.children) module.children = [];
/******/ 			return module;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/jsonp chunk loading */
/******/ 	(() => {
/******/ 		// no baseURI
/******/ 		
/******/ 		// object to store loaded and loading chunks
/******/ 		// undefined = chunk not loaded, null = chunk preloaded/prefetched
/******/ 		// [resolve, reject, Promise] = chunk loading, 0 = chunk loaded
/******/ 		var installedChunks = {
/******/ 			"worldmap": 0
/******/ 		};
/******/ 		
/******/ 		// no chunk on demand loading
/******/ 		
/******/ 		// no prefetching
/******/ 		
/******/ 		// no preloaded
/******/ 		
/******/ 		// no HMR
/******/ 		
/******/ 		// no HMR manifest
/******/ 		
/******/ 		__webpack_require__.O.j = (chunkId) => (installedChunks[chunkId] === 0);
/******/ 		
/******/ 		// install a JSONP callback for chunk loading
/******/ 		var webpackJsonpCallback = (parentChunkLoadingFunction, data) => {
/******/ 			var [chunkIds, moreModules, runtime] = data;
/******/ 			// add "moreModules" to the modules object,
/******/ 			// then flag all "chunkIds" as loaded and fire callback
/******/ 			var moduleId, chunkId, i = 0;
/******/ 			if(chunkIds.some((id) => (installedChunks[id] !== 0))) {
/******/ 				for(moduleId in moreModules) {
/******/ 					if(__webpack_require__.o(moreModules, moduleId)) {
/******/ 						__webpack_require__.m[moduleId] = moreModules[moduleId];
/******/ 					}
/******/ 				}
/******/ 				if(runtime) var result = runtime(__webpack_require__);
/******/ 			}
/******/ 			if(parentChunkLoadingFunction) parentChunkLoadingFunction(data);
/******/ 			for(;i < chunkIds.length; i++) {
/******/ 				chunkId = chunkIds[i];
/******/ 				if(__webpack_require__.o(installedChunks, chunkId) && installedChunks[chunkId]) {
/******/ 					installedChunks[chunkId][0]();
/******/ 				}
/******/ 				installedChunks[chunkId] = 0;
/******/ 			}
/******/ 			return __webpack_require__.O(result);
/******/ 		}
/******/ 		
/******/ 		var chunkLoadingGlobal = self["webpackChunkHearts_Of_Iron_IV_Utilities_2026"] = self["webpackChunkHearts_Of_Iron_IV_Utilities_2026"] || [];
/******/ 		chunkLoadingGlobal.forEach(webpackJsonpCallback.bind(null, 0));
/******/ 		chunkLoadingGlobal.push = webpackJsonpCallback.bind(null, chunkLoadingGlobal.push.bind(chunkLoadingGlobal));
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module depends on other loaded chunks and execution need to be delayed
/******/ 	var __webpack_exports__ = __webpack_require__.O(undefined, ["common"], () => (__webpack_require__("./webviewsrc/worldmap/index.ts")))
/******/ 	__webpack_exports__ = __webpack_require__.O(__webpack_exports__);
/******/ 	
/******/ })()
;
//# sourceMappingURL=worldmap.js.map