import React from 'react';
import type { GroveState } from '../../api/types';

interface GroveStateStepperProps {
  state: GroveState;
}

const STEPS = ['PREPARING', 'PLANTING', 'GROWING', 'FLOURISHING'] as const;
const STEP_LABELS = ['Preparing', 'Planting', 'Growing', 'Flourishing'];

function getStepIndex(state: GroveState): number {
  const idx = STEPS.indexOf(state as typeof STEPS[number]);
  return idx >= 0 ? idx : -1;
}

export function GroveStateStepper({ state }: GroveStateStepperProps): React.ReactElement {
  const currentStep = getStepIndex(state);

  return (
    <div className="stepper">
      {STEPS.map((step, i) => {
        const isActive = i === currentStep;
        const isCompleted = currentStep > i;
        const statusClass = isCompleted ? 'completed' : isActive ? 'active' : 'pending';

        return (
          <React.Fragment key={step}>
            <div className={`step ${statusClass}`}>
              <div className={`step-indicator ${statusClass}`}>
                {isCompleted ? '✓' : i + 1}
              </div>
              <span className={`step-label ${statusClass}`}>{STEP_LABELS[i]}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`step-connector ${isCompleted ? 'completed' : ''}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
