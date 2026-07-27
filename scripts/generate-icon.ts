import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

import sharp from 'sharp';

const outputDirectory = resolve(process.cwd(), 'build');
mkdirSync(outputDirectory, { recursive: true });
await sharp(resolve(process.cwd(), 'assets', 'icon-source.svg'))
  .resize(512, 512)
  .png()
  .toFile(resolve(outputDirectory, 'icon.png'));
