import Ajv, { ErrorObject } from "ajv";
import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

// Declare diagnosticCollection at the top level
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  console.log("Smarter YAML Manifest Extension is now active.");

  // Initialize the diagnostic collection
  diagnosticCollection = vscode.languages.createDiagnosticCollection("yaml");
  context.subscriptions.push(diagnosticCollection);

  vscode.workspace.onDidOpenTextDocument((document) => {
    if (document.languageId === "yaml" && isSmarterManifest(document)) {
      console.log("Validating Smarter Manifest YAML document...");
      validateYaml(document, diagnosticCollection);
    }
  });

  vscode.workspace.onDidChangeTextDocument((event) => {
    const document = event.document;
    if (document.languageId === "yaml" && isSmarterManifest(document)) {
      console.log("Re-validating Smarter Manifest YAML document...");
      validateYaml(document, diagnosticCollection);
    }
  });

  // Register completion provider for YAML reserved keywords
  const completionProvider = vscode.languages.registerCompletionItemProvider(
    { language: "yaml", scheme: "file" },
    {
      provideCompletionItems(document, position) {
        if (!isSmarterManifest(document)) {
          return []; // Skip completion for non-Smarter Manifest YAML files
        }

        const keywords = ["apiVersion", "kind", "metadata", "spec", "status"];
        return keywords.map(
          (keyword) =>
            new vscode.CompletionItem(
              keyword,
              vscode.CompletionItemKind.Keyword,
            ),
        );
      },
    },
  );
  context.subscriptions.push(completionProvider);
}

function isSmarterManifest(document: vscode.TextDocument): boolean {
  const text = document.getText();
  const yaml = require("js-yaml");
  const parsedYaml = yaml.load(text);
  if (parsedYaml && parsedYaml.apiVersion == "smarter.sh/v1") {
    return true;
  }
  return false;
}

export function deactivate() {
  console.log("Smarter YAML Manifest Extension is now deactivated.");
}

function validateYaml(
  document: vscode.TextDocument,
  diagnosticCollection: vscode.DiagnosticCollection,
) {
  console.log("Validating YAML document...");
  const diagnostics: vscode.Diagnostic[] = [];
  const text = document.getText();

  try {
    const yaml = require("js-yaml");
    const ajv = new Ajv({ allErrors: true, strict: false });
    const parsedYaml = yaml.load(text);

    console.log("Checking for kind...");
    if (parsedYaml && parsedYaml.kind) {
      const kind = parsedYaml.kind;
      console.log(`Checking for schema for kind: ${kind}`);
      const schemaPath = path.join(
        __dirname,
        `../schemas/${kind.toLowerCase()}.json`,
      );
      console.log(`Schema path: ${schemaPath}`);
      if (fs.existsSync(schemaPath)) {
        const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
        const validate = ajv.compile(schema);
        console.log("Validating YAML document against schema...");

        if (!validate(parsedYaml)) {
          validate.errors?.forEach((error: ErrorObject) => {
            const errorPath = error.instancePath.split("/").slice(1); // Remove leading slash
            const line = text
              .split("\n")
              .findIndex((line) =>
                line.includes(errorPath[0] ?? error.message ?? ""),
              );
            const range =
              line >= 0
                ? new vscode.Range(line, 0, line, text.split("\n")[line].length)
                : new vscode.Range(0, 0, 0, 1);

            diagnostics.push(
              new vscode.Diagnostic(
                range,
                `Schema validation error: ${error.message}`,
                vscode.DiagnosticSeverity.Error,
              ),
            );
          });
        }
      } else {
        const line = text
          .split("\n")
          .findIndex((line) => line.trim().startsWith("kind"));
        const range =
          line >= 0
            ? new vscode.Range(line, 0, line, text.split("\n")[line].length)
            : new vscode.Range(0, 0, 0, 1);

        diagnostics.push(
          new vscode.Diagnostic(
            range,
            `Schema for kind '${kind}' not found.`,
            vscode.DiagnosticSeverity.Warning,
          ),
        );
      }
    } else {
      const line = text
        .split("\n")
        .findIndex((line) => line.trim().startsWith("kind"));
      const range =
        line >= 0
          ? new vscode.Range(line, 0, line, text.split("\n")[line].length)
          : new vscode.Range(0, 0, 0, 1);

      diagnostics.push(
        new vscode.Diagnostic(
          range,
          "Missing 'kind' field in the manifest.",
          vscode.DiagnosticSeverity.Error,
        ),
      );
    }
  } catch (error) {
    if (error instanceof Error) {
      const line = (error as any).mark?.line || 0;
      const column = (error as any).mark?.column || 0;
      const range = new vscode.Range(line, column, line, column + 1);
      diagnostics.push(
        new vscode.Diagnostic(
          range,
          error.message,
          vscode.DiagnosticSeverity.Error,
        ),
      );
    } else {
      console.error("An unknown error occurred:", error);
    }
  }

  diagnosticCollection.set(document.uri, diagnostics);
}
