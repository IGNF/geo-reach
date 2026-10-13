import { Box, Stack, Typography } from '@ign-junn/design-system';
import type { ReactElement } from 'react';
import { t } from '@/locales';

/** The name of the app and its tagline, with its colored dot */
const Brand = (): ReactElement => (
  <Box component="header" className="brand">
    <Box component="span" className="brand-dot" />
    <Stack gap={0}>
      <Typography variant="subtitle1">{t.appName}</Typography>
      <Typography variant="caption">{t.tagline}</Typography>
    </Stack>
  </Box>
);

export default Brand;
