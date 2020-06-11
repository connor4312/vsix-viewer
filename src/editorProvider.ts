import * as vscode from 'vscode';
import { loadPackageMetadata, IPackageMetadata } from './loadPackageMetadata';
import render from './webview';
import * as execa from 'execa';

export class VsixViewerEditorProvider
  implements vscode.CustomReadonlyEditorProvider<CustomVsixDocument> {
  /**
   * viewType the custom editor provides.
   */
  public static readonly viewType = 'connor4312.vsixViewer';

  /**
   * Registers the editor provider's contributions.
   */
  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new VsixViewerEditorProvider(context);
    const providerRegistration = vscode.window.registerCustomEditorProvider(
      VsixViewerEditorProvider.viewType,
      provider,
    );
    return providerRegistration;
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * @inheritdoc
   */
  async openCustomDocument(uri: vscode.Uri) {
    return new CustomVsixDocument(uri, await loadPackageMetadata(uri.fsPath));
  }

  public async resolveCustomEditor(
    document: CustomVsixDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    webviewPanel.webview.options = { enableScripts: true };

    const id = `${document.metadata.publisher}.${document.metadata.name}`;
    const installed = vscode.extensions.getExtension(id);

    webviewPanel.webview.html = render({
      ...document.metadata,
      id,
      installed,
      installedCmp: installed
        ? semverCompare(document.metadata.version, installed.packageJSON.version)
        : undefined,
    });

    webviewPanel.webview.onDidReceiveMessage(async (event) => {
      if (!('command' in event)) {
        return;
      }

      try {
        switch (event.command) {
          case 'install':
            const previous = vscode.extensions.getExtension(id);

            // hack:
            await execa(
              process.execPath,
              [
                `${process.env.VSCODE_CWD}/resources/app/out/cli.js`,
                '--install-extension',
                document.uri.fsPath,
                '--force', // allow downgrade
              ],
              { env: { ELECTRON_RUN_AS_NODE: '1' } },
            );

            // note: vscode.extensions.onDidChange does not seem to fire for
            // upgrade/downgrades. Watch it manually here.
            while (vscode.extensions.getExtension(id) === previous) {
              await new Promise(r => setTimeout(r, 200));
            }

            await vscode.commands.executeCommand('workbench.action.reloadWindow');
            break;
        }
      } catch (e) {
        vscode.window.showErrorMessage(e.message);
      }
    });
  }
}

class CustomVsixDocument implements vscode.CustomDocument {
  constructor(public readonly uri: vscode.Uri, public readonly metadata: IPackageMetadata) {}

  dispose() {
    // no-op
  }
}

function semverCompare(a: string, b: string) {
  const partsA = a.split('.');
  const partsB = b.split('.');
  for (let i = 0; i < 3; i++) {
    const delta = Number(partsA[i]) - Number(partsB[i]);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}
