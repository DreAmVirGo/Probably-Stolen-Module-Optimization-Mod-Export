import { useCallback, useEffect, useRef, useState } from 'react';
import { createProgressClock, progressScore, progressTargetScore, progressTargetSummary } from '../optimizationProgress';
import type { ProgressMachine } from '../optimizationProgress';

export type OptimizationProgressSnapshot = {
    context: string;
    // Running machines provide Auto progress when the page has no explicit targets.
    machines: ProgressMachine[];
    // All-page target status and target progress, including stopped/locked machines.
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
};

// Poll live boards once a second while solving. A run's elapsed clock survives
// goal/context and dropdown changes; only starting another run resets it.
export const useOptimizationProgress = (
    readSnapshot: () => OptimizationProgressSnapshot | null,
    active: boolean,
    resetKey: string,
    idleThresholdSeconds = 60,
): OptimizationProgress | null => {
    const reader = useRef(readSnapshot);
    const [clock] = useState(() => createProgressClock());
    const session = useRef({ running: false, resetKey });
    const [progress, setProgress] = useState<OptimizationProgress | null>(null);
    const sample = useCallback(() => {
        const now = performance.now();
        const snapshot = reader.current();
        if (!snapshot) {
            if (active) clock.observe('', [], now);
            setProgress(previous => previous === null ? previous : null);
            return;
        }
        const targetMachines = snapshot.targetMachines ?? snapshot.machines;
        if (active) {
            const targeted = progressTargetScore(targetMachines);
            clock.observe(snapshot.context, targeted.length > 0 ? targeted : progressScore(snapshot.machines), now);
        }
        const summary = progressTargetSummary(targetMachines);
        const next: OptimizationProgress = {
            ...summary,
            running: active,
            stable: active && clock.isStable(now),
            idleSeconds: active ? Math.floor(clock.getIdleMs(now) / 1000) : 0,
            elapsedSeconds: Math.floor(clock.getElapsedMs(now) / 1000),
        };
        setProgress(previous => previous !== null && (Object.keys(next) as (keyof OptimizationProgress)[]).every(key => previous[key] === next[key])
            ? previous : next);
    }, [active, clock]);

    useEffect(() => {
        reader.current = readSnapshot;
        // Idle views still update target counts when a board or goal changes,
        // without leaving a polling interval running after the solver stops.
        if (!active) sample();
    }, [readSnapshot, active, sample]);

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

    // Hide an old running hint immediately on stop, before the effect freezes
    // the final fractional second and publishes the last elapsed value.
    return !active && progress?.running ? { ...progress, running: false, stable: false, idleSeconds: 0 } : progress;
};
