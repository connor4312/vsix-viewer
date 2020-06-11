import * as yauzl from 'yauzl';
import * as xml from 'xml2js';
import { promises as fs } from 'fs';
import { basename } from 'path';

interface IInternalExtensionManifest {
  PackageManifest: {
    Metadata: {
      License: string[];
      Icon?: string[];
    }[];
    Assets: {
      Asset: {
        $: {
          Type: string;
          Path: string;
          Addressable: string;
        };
      }[];
    }[];
  };
}

interface IPackageJson {
  name: string;
  displayName: string;
  version: string;
  publisher: string;
}

type EntryWithContents = Pick<
  yauzl.Entry,
  { [K in keyof yauzl.Entry]: yauzl.Entry[K] extends Function ? never : K }[keyof yauzl.Entry]
> & { contents: Buffer };

export interface IPackageMetadata extends IPackageJson {
  compressedSize: number;
  filename: string;
  iconDataUri?: string;
  licenseText: string;
}

export const loadPackageMetadata = async (vsixPath: string): Promise<IPackageMetadata> => {
  const { ['extension.vsixmanifest']: manifestEntry } = await extractFiles(vsixPath, [
    'extension.vsixmanifest',
  ]);
  const manifest: IInternalExtensionManifest = await mustParseXml(
    'extension.vsixmanifest',
    manifestEntry,
  );

  const packageFile = manifest.PackageManifest.Assets.find(
    (a) => a.Asset[0].$.Type === 'Microsoft.VisualStudio.Code.Manifest',
  )?.Asset[0].$.Path;
  const licenseFile = manifest.PackageManifest.Assets.find(
    (a) => a.Asset[0].$.Type === 'Microsoft.VisualStudio.Services.Content.License',
  )?.Asset[0].$.Path;
  const icon = manifest.PackageManifest.Metadata[0].Icon?.[0];
  if (!packageFile) {
    throw new Error('VS Code extension manifest not present');
  }

  const assets = await extractFiles(vsixPath, [packageFile, licenseFile, icon].filter((s): s is string => !!s));
  const stat = await fs.stat(vsixPath);
  let iconDataUri: string | undefined;
  if (icon && icon && assets[icon]) {
    iconDataUri = `data:image/png;base64,${assets[icon].contents.toString('base64')}`;
  }

  return {
    ...mustParseJson(packageFile, assets[packageFile]),
    filename: basename(vsixPath),
    compressedSize: stat.size,
    iconDataUri,
    licenseText: licenseFile ? assets[licenseFile]?.contents.toString() : undefined,
  };
};

/**
 * Parses JSON from the file and entry. Throws if not present or invalid.
 */
const mustParseJson = (filename: string, entry: EntryWithContents | undefined) => {
  if (!entry) {
    throw new Error(`Cound not find file ${filename} in package`);
  }

  try {
    return JSON.parse(entry.contents.toString('utf-8'));
  } catch (e) {
    throw new Error(`Error parsing JSON in ${filename}: ${e.stack}`);
  }
};

/**
 * Parses XML from the file and entry. Throws if not present or invalid.
 */
const mustParseXml = async (filename: string, entry: EntryWithContents | undefined) => {
  if (!entry) {
    throw new Error(`Cound not find file ${filename} in package`);
  }

  try {
    return await xml.parseStringPromise(entry.contents.toString('utf-8'));
  } catch (e) {
    throw new Error(`Error parsing XML in ${filename}: ${e.stack}`);
  }
};

/**
 * Extracts files with the given set of paths from the archive, returning
 * a map of their contents.
 */
const extractFiles = async (zipPath: string, fileList: Iterable<string>) => {
  const archive = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => (err ? reject(err) : resolve(zip))),
  );
  const result: { [filename: string]: EntryWithContents } = {};
  const todo: Promise<void>[] = [];
  const files = new Set(fileList);

  // promise that resolves once all desired files are in the `todo` read list
  await new Promise((resolve, reject) => {
    archive
      .on('end', resolve)
      .on('error', reject)
      .on('entry', (entry: yauzl.Entry) => {
        if (!files.has(entry.fileName)) {
          archive.readEntry();
          return;
        }

        todo.push(
          new Promise((resolve, reject) =>
            archive.openReadStream(entry, (err, stream) => {
              if (err) {
                return reject(err);
              }

              let data: Buffer[] = [];
              stream
                ?.on('error', reject)
                .on('data', (chunk) => data.push(chunk))
                .on('end', () => {
                  result[entry.fileName] = { ...entry, contents: Buffer.concat(data) };
                  resolve();
                });
            }),
          ),
        );

        files.delete(entry.fileName);

        // remove the file as we read it. If we have no more files, no need to read more entries
        if (files.size === 0) {
          resolve();
        } else {
          archive.readEntry();
        }
      });

    archive.readEntry();
  });

  await Promise.all(todo);
  archive.close();

  return result;
};

loadPackageMetadata('src/test/sample-extension.vsix').then(console.log).catch(console.error);
