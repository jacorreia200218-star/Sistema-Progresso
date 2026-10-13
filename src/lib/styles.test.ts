import { describe, expect, it } from 'vitest';
import { transform } from 'lightningcss';
import css from '../styles.css?raw';

// A folha de estilos tem de ser válida: um erro de sintaxe pode desfazer o estilo
// só no telemóvel ou falhar a publicação.
describe('folha de estilos', () => {
  it('é CSS válido (como na publicação)', () => {
    expect(() => transform({ filename: 'styles.css', code: new TextEncoder().encode(css), minify: true })).not.toThrow();
  });
});
