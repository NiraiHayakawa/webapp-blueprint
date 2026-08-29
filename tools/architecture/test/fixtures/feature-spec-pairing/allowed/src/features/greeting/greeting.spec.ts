import { describeFeature, loadFeature } from "@amiceli/vitest-cucumber";

const feature = await loadFeature("./greeting.feature");

describeFeature(feature, ({ Scenario }) => {
  Scenario("名前を渡すと挨拶になる", ({ Given, Then }) => {
    Given("名前がある", () => {});
    Then("挨拶が返る", () => {});
  });
});
