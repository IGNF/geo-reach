import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import '@ign-junn/design-system/styles.css';
import '../howItWorks/howItWorks.css';
import theme from '@ign-junn/design-system/theme';
import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Legal from './Legal';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <MantineProvider theme={theme} forceColorScheme="light">
      <Legal />
    </MantineProvider>
  </StrictMode>,
);
