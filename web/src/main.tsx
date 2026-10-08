import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import '@ign-junn/design-system/styles.css';
import './index.css';
import theme from '@ign-junn/design-system/theme';
import { MantineProvider } from '@mantine/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = document.getElementById('root');
if (!root) throw new Error('#root missing');

createRoot(root).render(
  <StrictMode>
    <MantineProvider theme={theme} forceColorScheme="light">
      <App />
    </MantineProvider>
  </StrictMode>,
);
