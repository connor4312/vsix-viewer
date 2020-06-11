import { IPackageMetadata } from './loadPackageMetadata';
import { Extension } from 'vscode';

export interface IRenderData extends IPackageMetadata {
  installed: Extension<unknown> | undefined;
  id: string;
  installedCmp: number | undefined;
}

const fn: (data: IRenderData) => string = require('./webview-raw');

export default fn;
