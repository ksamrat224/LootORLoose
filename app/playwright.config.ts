import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  timeout: 30000,
  use: { baseURL: "http://localhost:3200", trace: "retain-on-failure" },
  webServer: [
    {
      command:
        "NEXT_TEST_DIST=.next-quest-tests NEXT_PUBLIC_WAGER_V3_ENABLED=true NEXT_PUBLIC_QUEST_V4_ENABLED=true npm run dev -- --hostname localhost --port 3102",
      url: "http://localhost:3102",
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command:
        "NEXT_TEST_DIST=.next-practice-tests NEXT_PUBLIC_WAGER_V3_ENABLED=false NEXT_PUBLIC_QUEST_V4_ENABLED=false npm run dev -- --hostname localhost --port 3200",
      url: "http://localhost:3200",
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command:
        "NEXT_TEST_DIST=.next-wager-tests NEXT_PUBLIC_WAGER_V3_ENABLED=true NEXT_PUBLIC_QUEST_V4_ENABLED=false npm run dev -- --hostname localhost --port 3100",
      url: "http://localhost:3100",
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});
