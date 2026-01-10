{inputs, ...}: {
  imports = [
    inputs.process-compose-flake.flakeModule
  ];

  perSystem = {
    config,
    lib,
    pkgs,
    ...
  }: {
    process-compose.start = {
      imports = [
        inputs.services-flake.processComposeModules.default
      ];

      services.postgres."pg1" = {
        enable = true;
        port = 5433;

        superuser = "cctp";
        initialScript.after = ''
          ALTER DATABASE cctp OWNER TO cctp;
          GRANT ALL PRIVILEGES ON DATABASE cctp TO cctp;
        '';

        initialDatabases = [
          {
            name = "cctp";
          }
        ];
      };

      # Override environment for PostgreSQL to ensure it uses postgres superuser
      settings.processes.pg1.environment = {
        PGUSER = ""; # Clear PGUSER to use default postgres user
      };

      # Run SvelteKit development server with explicit pnpm path
      settings.processes.svelte-dev = {
        command = toString (pkgs.writeShellScript "svelte-dev" ''
          export PATH="${pkgs.nodejs_24}/bin:${pkgs.pnpm}/bin:$PATH"
          cd "$PRJ_ROOT"
          exec pnpm run dev
        '');
        depends_on."pg1".condition = "process_healthy";
        environment = {
          PGHOST = "localhost";
          PGPORT = "5433";
          PGDATABASE = "cctp";
          PGUSER = "cctp";
          PGPASSWORD = "cctp";
          NODE_ENV = "development";
        };
      };
    };
  };
}
