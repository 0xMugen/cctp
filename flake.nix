{
  description = "CCTP Bridge - Cross-Chain Transfer Protocol bridging with Circle";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    flake-parts.url = "github:hercules-ci/flake-parts";
    systems.url = "github:nix-systems/default";
    services-flake.url = "github:juspay/services-flake";
    process-compose-flake.url = "github:Platonic-Systems/process-compose-flake";
  };

  outputs = inputs @ {flake-parts, ...}:
    flake-parts.lib.mkFlake {inherit inputs;} {
      imports = [
        ./nix-flake/process-compose.nix
      ];

      systems = import inputs.systems;

      perSystem = {
        config,
        self',
        inputs',
        pkgs,
        system,
        ...
      }: {
        # pnpm package override with specific version
        _module.args.pkgs = import inputs.nixpkgs {
          inherit system;
          config.allowUnfree = true;

          overlays = [
            (final: prev: {
              # Use the latest version of pnpm
              pnpm = prev.pnpm;
            })
          ];
        };

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_24
            pnpm

            graphite-cli

            postgresql
            # Add playwright dependencies for testing
            playwright-driver.browsers
          ];

          shellHook = ''
            echo "🌉 CCTP Bridge development environment"
            echo "Node.js: $(node --version)"
            echo "pnpm: $(pnpm --version)"
            echo "PostgreSQL: $(postgres --version)"
            export PLAYWRIGHT_BROWSERS_PATH=${pkgs.playwright-driver.browsers}
            export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=true

            # Create data directory
            export PRJ_DATA_DIR="$PWD/.data"
            mkdir -p "$PRJ_DATA_DIR"

            # Create start command
            start() {
              echo "🌉 Starting CCTP Bridge development environment..."
              nix run .#start
            }

            echo ""
            echo "💡 Quick start: run 'start' to launch PostgreSQL and SvelteKit dev server with process-compose"
            echo "💡 Or run 'nix run .#start' directly to start the development environment"
          '';
        };

        packages = {
          default = self'.packages.cctp;

          cctp = pkgs.stdenv.mkDerivation rec {
            pname = "cctp";
            version = "0.0.1";

            src = ./.;

            nativeBuildInputs = with pkgs; [
              nodejs_20
              pnpm.configHook
            ];

            pnpmDeps = pkgs.pnpm.fetchDeps {
              pname = "cctp";
              version = "0.0.1";
              src = ./.;
              hash = "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
            };

            buildPhase = ''
              runHook preBuild
              pnpm build
              runHook postBuild
            '';

            installPhase = ''
              runHook preInstall
              mkdir -p $out
              cp -r build/* $out/
              cp package.json $out/

              # Copy production dependencies
              cp -r node_modules $out/

              # Copy migrations directory
              cp -r migrations $out/

              # Create a simple startup script
              mkdir -p $out/bin
              cat > $out/bin/cctp <<EOF
              #!/bin/sh
              cd $out
              ${pkgs.nodejs_20}/bin/node index.js
              EOF
              chmod +x $out/bin/cctp
              runHook postInstall
            '';
          };

          # Docker image using the Nix approach from the tutorial
          dockerImage = pkgs.dockerTools.buildImage {
            name = "cctp";
            tag = "latest";

            copyToRoot = pkgs.buildEnv {
              name = "image-root";
              paths = [
                self'.packages.cctp
                pkgs.nodejs_20
                pkgs.busybox
                pkgs.cacert
              ];
              pathsToLink = ["/bin" "/etc"];
            };

            config = {
              Cmd = ["/bin/cctp"];
              ExposedPorts = {
                "3000/tcp" = {};
              };
              Env = [
                "NODE_ENV=production"
                "PORT=3000"
                "HOST=0.0.0.0"
                "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
                "NODE_EXTRA_CA_CERTS=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
              ];
              WorkingDir = "/";
            };
          };
        };

        apps = {
          default = self'.apps.cctp;

          cctp = {
            type = "app";
            program = "${self'.packages.cctp}/bin/cctp";
          };

          # Helper to load Docker image
          loadDocker = {
            type = "app";
            program = toString (pkgs.writeShellScript "load-docker" ''
              echo "Loading Docker image..."
              ${self'.packages.dockerImage} | ${pkgs.docker}/bin/docker load
              echo "Docker image loaded! Run with: docker run -p 3000:3000 cctp:latest"
            '');
          };
        };
      };
    };
}
