# Aura Desk — Aplicativo desktop de produtividade

Desenvolver um aplicativo desktop multiplataforma para Windows e Linux, com foco inicial em NixOS com Nix Flakes.

## Objetivo
Criar um centro de comando pessoal para produtividade, com dashboard permanente no segundo monitor, tarefas, Kanban, Pomodoro, lembretes persistentes e integração com o assistente Hermes por texto e voz.

## Stack
- Tauri 2
- Rust para o núcleo e as regras de negócio
- React + TypeScript para a interface
- SQLite para persistência local
- Nix Flakes para desenvolvimento reproduzível no NixOS
- Build multiplataforma para Linux e Windows

## Módulos
1. Dashboard principal: Pomodoro, próxima tarefa, tarefas pendentes, últimas notificações, hidratação e pausas.
2. Tarefas: cadastro rápido, prioridades, prazos, estimativas, recorrência e projetos de longo prazo.
3. Kanban: A fazer, Em andamento, Aguardando e Concluído.
4. Lembretes: alertas persistentes com som e ações explícitas de resolver, adiar ou registrar exceção.
5. Rotinas: lembretes de água, pausas e planejamento diário às 07:50.
6. Métricas: sessões de foco, atividade do computador, pausas e histórico.
7. Aura IA: transformar comandos em linguagem natural em propostas de tarefas e lembretes, com aprovação do usuário.
8. Desktop: seleção do monitor, janela principal em tela cheia, bandeja do sistema e inicialização automática configurável.

## Requisitos essenciais
- O núcleo deve funcionar sem IA e sem conexão com a internet.
- Os dados e alertas pendentes devem sobreviver a reinicializações.
- A janela principal pode ser ocultada sem encerrar o aplicativo.
- O monitor preferido deve ser configurável.
- Alertas persistentes não podem desaparecer sem uma ação explícita.
- Operações da IA devem utilizar comandos validados, nunca modificar o banco diretamente.
- A interface deve ser rápida, intuitiva, acessível e visualmente consistente.

## Estratégia de desenvolvimento
Implementar incrementalmente: fundação e banco de dados; tarefas e Kanban; Pomodoro e alertas; integração com o desktop e segundo monitor; planejamento diário; IA por texto; voz via Hermes.

Começar pelo MVP. Não implementar nuvem, sincronização entre dispositivos ou aplicativo móvel nesta fase. Antes de modificar arquivos, inspecionar o repositório existente e apresentar um plano de implementação. Preservar arquivos e configurações preexistentes, adicionar testes e documentar os critérios de aceitação.
