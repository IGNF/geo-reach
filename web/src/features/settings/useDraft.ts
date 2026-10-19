import { useState } from 'react';

/** The props of a slider that shows its value while the thumb moves and hands it over once released */
export interface Draft {
  value: number;
  onChange: (value: number) => void;
  onChangeEnd: (value: number) => void;
}

/**
 * A slider whose value rebuilds the profile (hour, speeds, transfer): the thumb and its label follow every step, the
 * value is committed once released. Committed at each step, every one would rebuild the costs of the whole network
 * and anchor every building again.
 */
export const useDraft = (value: number, commit: (value: number) => void): Draft => {
  const [draft, setDraft] = useState<number>();

  return {
    value: draft ?? value,
    onChange: setDraft,
    onChangeEnd: (end) => {
      setDraft(undefined);
      commit(end);
    },
  };
};
