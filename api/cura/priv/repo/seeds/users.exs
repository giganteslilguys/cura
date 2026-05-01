defmodule Cura.Repo.Seeds.Accounts do
  alias Cura.Accounts

  @first_names File.read!("priv/fake/first_names.txt") |> String.split("\n", trim: true)
  @last_names File.read!("priv/fake/last_names.txt") |> String.split("\n", trim: true)

  def run do
    case Cura.Repo.aggregate(Cura.Accounts.User, :count) do
      0 ->
        seed_users()

      _ ->
        IO.puts("Users already exist, skipping seeding.")
    end
  end

  def seed_users(doctors \\ 15, patients \\ 50) do
    seed_role(:doctor, doctors)
    seed_role(:patient, patients)
  end

  defp seed_role(role, count) do
    for i <- 1..count do
      first_name = Enum.random(@first_names)
      last_name = @last_names |> Enum.take_random(2) |> Enum.join(" ")
      email = "#{role}#{i}@cura.pt"

      attrs = %{
        first_name: first_name,
        last_name: last_name,
        email: email,
        password: "password1234",
        role: role
      }

      case Accounts.register_user(attrs) do
        {:ok, user} ->
          Mix.shell().info("Created #{role} #{user.first_name} #{user.last_name} (#{email})")

        {:error, changeset} ->
          Mix.shell().error(
            "Error creating #{role} #{i}: " <> Kernel.inspect(changeset.errors)
          )
      end
    end
  end
end

Cura.Repo.Seeds.Accounts.run()
