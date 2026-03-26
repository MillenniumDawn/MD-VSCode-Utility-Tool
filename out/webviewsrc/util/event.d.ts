import { BehaviorSubject, Subscription } from 'rxjs';
export type Disposable = {
    dispose(): void;
};
export declare function toDisposable(...subscription: Subscription[]): Disposable;
export declare class Subscriber implements Disposable {
    private rxjsSubscriptions;
    private subscriptions;
    addSubscription(subscription: Subscription | Disposable): void;
    dispose(): void;
}
export declare function toBehaviorSubject<T extends string>(element: HTMLSelectElement | HTMLInputElement, initialValue?: T): BehaviorSubject<T>;
