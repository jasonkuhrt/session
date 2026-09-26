/**
 * The project's own lint rules, loaded by oxlint as a JS plugin. It is plain
 * JavaScript so that any Node that runs oxlint runs it, without type stripping.
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
  }),
};

export default {
  meta: { name: 'session' },
  rules: { 'derived-contract-types': derivedContractTypes },
};
