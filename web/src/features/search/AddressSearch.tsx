import { Autocomplete, Box } from '@ign-junn/design-system';
import { IconSearch } from '@ign-junn/design-system/icons';
import { type ReactElement, useEffect, useState } from 'react';
import type { LngLat } from '@/shared/config';
import { completeAddress, type Suggestion } from '@/shared/gpf';
import { t } from '@/locales';

/** Milliseconds of calm in the typing before asking the Géoplateforme */
const TYPING_MS = 200;
/** Shorter texts are not worth a request */
const MIN_CHARACTERS = 3;

interface AddressSearchProps {
  /** An address or a place was chosen: the map goes there */
  onGo: (point: LngLat) => void;
}

/** Search for an address or a place anywhere in metropolitan France, with suggestions while typing */
const AddressSearch = ({ onGo }: AddressSearchProps): ReactElement => {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const text = query.trim();
  // Too short a text offers nothing, whatever an older request answered
  const shown = text.length >= MIN_CHARACTERS ? suggestions : [];

  useEffect(() => {
    if (text.length < MIN_CHARACTERS) return undefined;

    // The latest text only: a request still running for an older one is cancelled
    const controller = new AbortController();
    const timer = setTimeout(() => {
      completeAddress(text, controller.signal)
        .then(setSuggestions)
        .catch(() => undefined);
    }, TYPING_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [text]);

  const go = (label: string): void => {
    const chosen = shown.find((s) => s.label === label);
    if (chosen) onGo(chosen.point);
  };

  return (
    <Box className="address-search">
      <Autocomplete
        label={t.search.label}
        hideLabel
        placeholder={t.search.placeholder}
        icon={IconSearch}
        value={query}
        onChange={setQuery}
        suggestions={shown.map((s) => s.label)}
        unfiltered
        onSelect={go}
      />
    </Box>
  );
};

export default AddressSearch;
