import { Link, Page, Stack, Typography } from '@ign-junn/design-system';
import { IconArrowLeft, IconBrandGithub } from '@ign-junn/design-system/icons';
import { legal as l } from '../locales/legal';

const REPO = 'https://github.com/IGNF/geo-reach';

const Legal = () => (
  <Page width="medium">
    <Stack gap="xl">
      <Stack gap="sm">
        <a className="back-link" href={import.meta.env.BASE_URL}>
          <IconArrowLeft size={16} />
          {l.backToMap}
        </a>
        <Typography variant="display">{l.title}</Typography>
      </Stack>
      {l.sections.map((section) => (
        <Stack key={section.title} gap="xs">
          <Typography variant="h2">{section.title}</Typography>
          {section.lines.map((line) => (
            <Typography key={line} variant="body1">
              {line}
            </Typography>
          ))}
        </Stack>
      ))}
      <Link href={REPO} icon={IconBrandGithub}>
        {l.repository}
      </Link>
    </Stack>
  </Page>
);

export default Legal;
