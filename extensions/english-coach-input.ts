import type { ExtensionContext, InputEvent } from "@oh-my-pi/pi-coding-agent";

type Observer = (event: InputEvent, ctx: ExtensionContext) => void;
type Routes = Map<string, Set<Observer>>;

const KEY = Symbol.for("omp-tools.english-coach-input");
const host = globalThis as unknown as Record<symbol, Routes | undefined>;
const routes = host[KEY] ??= new Map();

export function observeCoachInput(ctx: ExtensionContext, observer: Observer): () => void {
	const observers = routes.get(ctx.agent.id) ?? new Set<Observer>();
	routes.set(ctx.agent.id, observers);
	const seen = new WeakSet<ExtensionContext["models"]>();
	const once: Observer = (event, context) => {
		// OMP 18.20.3 creates a models query per dispatch, shared by its scoped handler contexts.
		if (seen.has(context.models)) return;
		seen.add(context.models);
		observer(event, context);
	};
	observers.add(once);
	return () => {
		observers.delete(once);
		if (observers.size === 0) routes.delete(ctx.agent.id);
	};
}

export function forwardCoachInput(event: InputEvent, ctx: ExtensionContext): void {
	for (const observer of routes.get(ctx.agent.id) ?? []) observer(event, ctx);
}
