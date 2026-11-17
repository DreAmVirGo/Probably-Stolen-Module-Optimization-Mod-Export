import { useEffect, useRef, useState } from 'react';
import { createProgressClock, progressScore, progressTargetsMet } from '../optimizationProgress';
import type { ProgressMachine } from '../optimizationProgress';

export type OptimizationProgressSnapshot = { context: string; machines: ProgressMachine[] };
export type OptimizationProgress = { stable: boolean; targetsMet: boolean; idleSeconds: number };

// Read live boards without making every solver report render the toolbar. Only
// genuine goal improvements reset the clock; layout/tiebreak changes do not.
export const useOptimizationProgress = (
    readSnapshot: () => OptimizationProgressSnapshot | null,
    active: boolean,
    resetKey: string,
): OptimizationProgress | null => {
    const reader = useRef(readSnapshot);
    const [clock] = useState(() => createProgressClock());
    const [progress, setProgress] = useState<(OptimizationProgress & { resetKey: string }) | null>(null);

    useEffect(() => { reader.current = readSnapshot; }, [readSnapshot]);

    useEffect(() => {
        clock.clear();
        if (!active) return;
        const tick = () => {
            const snapshot = reader.current();
            if (!snapshot || snapshot.machines.length === 0) {
                clock.clear();
                setProgress(previous => previous === null ? previous : null);
                return;
            }
            const now = performance.now();
            clock.observe(snapshot.context, progressScore(snapshot.machines), now);
            const stable = clock.isStable(now);
            const targetsMet = progressTargetsMet(snapshot.machines);
            // The banner is hidden during warmup. Avoid rendering a hidden idle
            // counter every second while the solver is already reporting often.
            const idleSeconds = stable ? Math.floor(clock.getIdleMs(now) / 1000) : 0;
            setProgress(previous => previous?.resetKey === resetKey && previous.stable === stable && previous.targetsMet === targetsMet && previous.idleSeconds === idleSeconds
                ? previous : { stable, targetsMet, idleSeconds, resetKey });
        };
        tick();
        const timer = window.setInterval(tick, 1000);
        return () => {
            window.clearInterval(timer);
            clock.clear();
        };
    }, [active, resetKey, clock]);

    // A stopped/new run never briefly displays the previous run's status while
    // its effect cleanup is waiting for the browser's next task.
    return active && progress?.resetKey === resetKey ? progress : null;
};
