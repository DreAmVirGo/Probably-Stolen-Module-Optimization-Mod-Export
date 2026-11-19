import { useCallback, useEffect, useRef, useState } from 'react';
import { createProgressClock, progressTargetSummary } from '../optimizationProgress';
import type { ProgressMachine } from '../optimizationProgress';

export type OptimizationProgressSnapshot = {
    context: string;
    // Running machines; also the watch set for callers without explicit selection.
    machines: ProgressMachine[];
    // Only checked, running machines affect the quiet clock. An explicit empty
    // array disables stagnation notices without erasing the run's elapsed time.
    watchedMachines?: ProgressMachine[];
    // All-page target status, including stopped/locked and unwatched machines.
    targetMachines?: ProgressMachine[];
};
export type OptimizationProgress = {
    running: boolean;
    stable: boolean;
    targetsMet: boolean;
    idleSeconds: number;
    elapsedSeconds: number;
    targetCount: number;
    metTargetCount: number;
    // Selected running cards, including cards whose stats are all off. A hint
    // still requires at least one comparable target or Auto objective.
    watchedCount: number;
};
type SampledProgress = OptimizationProgress & { sampledSelectionKey: string };

// Poll live boards once a second while solving. A run's elapsed clock survives
// goal/context and dropdown changes; only starting another run resets it.
export const useOptimizationProgress = (
    readSnapshot: () => OptimizationProgressSnapshot | null,
    active: boolean,
    resetKey: string,
    idleThresholdSeconds = 60,
    selectionKey = '',
): OptimizationProgress | null => {
    const reader = useRef(readSnapshot);
    const [clock] = useState(() => createProgressClock());
    const session = useRef({ running: false, resetKey });
    const selection = useRef(selectionKey);
    const [progress, setProgress] = useState<SampledProgress | null>(null);
    const sample = useCallback(() => {
        const now = performance.now();
        const snapshot = reader.current();
        if (!snapshot) {
            if (active) clock.observe('', [], now);
            setProgress(previous => previous === null ? previous : null);
            return;
        }
        const targetMachines = snapshot.targetMachines ?? snapshot.machines;
        const watched = snapshot.watchedMachines ?? snapshot.machines;
        if (active) clock.observeMachines(snapshot.context, watched, now);
        const summary = progressTargetSummary(targetMachines);
        const next: SampledProgress = {
            ...summary,
            running: active,
            stable: active && clock.isStable(now),
            idleSeconds: active ? Math.floor(clock.getIdleMs(now) / 1000) : 0,
            elapsedSeconds: Math.floor(clock.getElapsedMs(now) / 1000),
            watchedCount: active ? new Set(watched.map(machine => machine.id)).size : 0,
            sampledSelectionKey: selection.current,
        };
        setProgress(previous => previous !== null && (Object.keys(next) as (keyof SampledProgress)[]).every(key => previous[key] === next[key])
            ? previous : next);
    }, [active, clock]);

    useEffect(() => {
        reader.current = readSnapshot;
        selection.current = selectionKey;
        // Idle views still update target counts when a board or goal changes,
        // without leaving a polling interval running after the solver stops.
        if (!active) sample();
    }, [readSnapshot, active, sample, selectionKey]);

    useEffect(() => {
        const now = performance.now();
        if (active && (!session.current.running || session.current.resetKey !== resetKey)) clock.start(now);
        else if (!active && session.current.running) clock.stop(now);
        session.current = { running: active, resetKey };
        sample();
        if (!active) return;
        const timer = window.setInterval(sample, 1000);
        return () => { window.clearInterval(timer); };
    }, [active, resetKey, clock, sample]);

    useEffect(() => {
        clock.setIdleMs(idleThresholdSeconds * 1000);
        if (active) sample();
    }, [idleThresholdSeconds, active, clock, sample]);

    // Selection changes sample immediately without restarting the polling
    // interval or the elapsed session. The reader effect above runs first.
    useEffect(() => { if (active) sample(); }, [selectionKey, active, sample]);

    // Hide an old running hint immediately on stop, before the effect freezes
    // the final fractional second and publishes the last elapsed value.
    if (active && progress && progress.sampledSelectionKey !== selectionKey) return { ...progress, stable: false, idleSeconds: 0, watchedCount: 0 };
    return !active && progress?.running ? { ...progress, running: false, stable: false, idleSeconds: 0, watchedCount: 0 } : progress;
};
