/**
 * The project's own lint rules, loaded by oxlint as a JS plugin. It is plain
 * JavaScript so that any Node that runs oxlint runs it, without type stripping.
 *
 * oxlint's JS plugins are alpha and not under semver, so the plugin API can
 * change in any release: after every oxlint upgrade, append a hand-written
 * type, an interface, an enum and a re-export to `app/contract.ts`, and an
 * import of `@tanstack/react-hotkeys` to any board module but the binder, and
 * check that `bun run lint` refuses each one.
 */

/** Whether a type alias is `typeof <Name>Schema.Type`, the one form a contract type takes. */
const isDerived = (node) => {
  const { typeAnnotation: annotation } = node;
  return annotation.type === 'TSTypeQuery' &&
    annotation.exprName.type === 'TSQualifiedName' &&
    annotation.exprName.right.name === 'Type' &&
    annotation.exprName.left.type === 'Identifier' &&
    annotation.exprName.left.name === `${node.id.name}Schema`;
};

/** What a re-export is told: a noun the contract shares is defined in it. */
const reexported = 'the contract re-exports another module; a noun it shares is defined here, as a schema and its Type.';

const derivedContractTypes = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Every type in the contract is its schema’s Type, so a noun has one definition.',
    },
  },
  create: (context) => ({
    TSTypeAliasDeclaration: (node) => {
      if (isDerived(node)) return;
      const { name } = node.id;
      context.report({
        node,
        message: `${name} is written by hand; give it a schema, ${name}Schema, and derive it: \`export type ${name} = typeof ${name}Schema.Type\`.`,
      });
    },
    TSInterfaceDeclaration: (node) => {
      context.report({ node, message: `${node.id.name} is an interface written by hand; give it a schema and derive its type from it.` });
    },
    TSEnumDeclaration: (node) => {
      const { name } = node.id;
      context.report({
        node,
        message: `${name} is an enum written by hand; give it a schema, ${name}Schema, of \`Schema.Literals\`, and derive it: \`export type ${name} = typeof ${name}Schema.Type\`.`,
      });
    },
    ExportAllDeclaration: (node) => {
      context.report({ node, message: `\`export *\` from ${node.source.value}: ${reexported}` });
    },
    ExportNamedDeclaration: (node) => {
      if (node.source !== null && node.source !== undefined) {
        context.report({ node, message: `An export from ${node.source.value}: ${reexported}` });
      }
    },
  }),
};

/** The hotkey library, which only the substrate's binder may import: every key is bound from the registry, there. */
const hotkeyModules = new Set(['@tanstack/react-hotkeys', '@tanstack/hotkeys']);

const bound = 'the hotkey library is imported only by app/src/substrate/bind.ts, which binds every key from the registry; register a command there instead.';

const hotkeysInBinder = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Only the substrate’s binder imports the hotkey library, so every key is bound from the registry and nowhere else.',
    },
  },
  create: (context) => (context.filename.endsWith('app/src/substrate/bind.ts') ? {} : {
    ImportDeclaration: (node) => {
      if (hotkeyModules.has(node.source.value)) context.report({ node, message: `An import of ${node.source.value}: ${bound}` });
    },
    ImportExpression: (node) => {
      if (node.source.type === 'Literal' && hotkeyModules.has(node.source.value)) {
        context.report({ node, message: `An import of ${node.source.value}: ${bound}` });
      }
    },
    ExportNamedDeclaration: (node) => {
      if (node.source !== null && node.source !== undefined && hotkeyModules.has(node.source.value)) {
        context.report({ node, message: `An export from ${node.source.value}: ${bound}` });
      }
    },
    ExportAllDeclaration: (node) => {
      if (hotkeyModules.has(node.source.value)) context.report({ node, message: `An export from ${node.source.value}: ${bound}` });
    },
  }),
};

export default {
  meta: { name: 'session' },
  rules: { 'derived-contract-types': derivedContractTypes, 'hotkeys-in-binder': hotkeysInBinder },
};
