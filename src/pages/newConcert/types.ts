/** Origem da lista do concerto novo. */
export type Mode = 'import' | 'copy' | 'library' | 'empty'

/** Ecrã do assistente (espelhado no URL em ?passo=, para o "voltar" do browser/gesto funcionar). */
export type View = 'start' | 'copy' | 'library' | 'review'
