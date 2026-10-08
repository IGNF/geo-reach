import { Button, CollapsibleSection, SegmentedSwitch, Slider, Stack, Typography } from '@ign-junn/design-system';
import { DEFAULT_MODEL, type ModelOptions } from '../engine/profile';
import type { Mode } from '../lib/config';
import { t } from '../locales';

interface ModelSectionProps {
  mode: Mode;
  model: ModelOptions;
  onChange: (patch: Partial<ModelOptions>) => void;
}

const Value = ({ label, value }: { label: string; value: string }) => (
  <Stack direction="row" justify="space-between">
    <Typography variant="caption">{label}</Typography>
    <Typography variant="strong">{value}</Typography>
  </Stack>
);

/** The assumptions of the travel times that matter for the chosen mode */
const ModelSection = ({ mode, model, onChange }: ModelSectionProps) => {
  const walking = mode === 'pedestrian' || mode === 'transit';

  return (
    <CollapsibleSection title={t.model.title} description={t.model.description} defaultOpened={false}>
      <Stack gap="md">
        {walking && (
          <Stack gap={4}>
            <Value label={t.model.walk} value={t.kmh(model.walkKmh)} />
            <Slider label={t.model.walk} min={3} max={6} step={0.5} value={model.walkKmh} onChange={(v) => onChange({ walkKmh: v })} />
          </Stack>
        )}
        {mode === 'bike' && (
          <Stack gap={4}>
            <Value label={t.model.bike} value={t.kmh(model.bikeKmh)} />
            <Slider label={t.model.bike} min={10} max={25} step={1} value={model.bikeKmh} onChange={(v) => onChange({ bikeKmh: v })} />
          </Stack>
        )}
        {mode === 'car' && (
          <Stack direction="row" justify="space-between" align="center">
            <Typography variant="caption">{t.model.traffic}</Typography>
            <SegmentedSwitch
              label={t.model.traffic}
              value={model.traffic}
              onChange={(v) => onChange({ traffic: v })}
              options={[
                { value: 'estimated' as const, label: t.model.trafficOptions.estimated },
                { value: 'free' as const, label: t.model.trafficOptions.free },
              ]}
            />
          </Stack>
        )}
        {mode === 'transit' && (
          <>
            <Stack gap={4}>
              <Typography variant="caption">{t.model.wait}</Typography>
              <SegmentedSwitch
                label={t.model.wait}
                value={model.wait}
                onChange={(v) => onChange({ wait: v })}
                fullWidth
                options={[
                  { value: 'half' as const, label: t.model.waitOptions.half },
                  { value: 'full' as const, label: t.model.waitOptions.full },
                ]}
              />
              <Typography variant="hint">{t.model.waitHint}</Typography>
            </Stack>
            <Stack gap={4}>
              <Value label={t.model.transfer} value={t.minutes(model.transferMin)} />
              <Slider
                label={t.model.transfer}
                min={0}
                max={5}
                step={0.5}
                value={model.transferMin}
                onChange={(v) => onChange({ transferMin: v })}
              />
            </Stack>
          </>
        )}
        <Button label={t.model.reset} variant="subtle" size="xs" onClick={() => onChange(DEFAULT_MODEL)} />
      </Stack>
    </CollapsibleSection>
  );
};

export default ModelSection;
