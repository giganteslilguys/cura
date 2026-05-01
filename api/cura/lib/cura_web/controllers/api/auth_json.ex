defmodule CuraWeb.Api.AuthJSON do
  alias Cura.Accounts.User

  def user(%{user: user}), do: %{user: data(user)}

  def user_with_token(%{user: user, token: token}) do
    %{user: data(user), token: token}
  end

  defp data(%User{} = user) do
    %{
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role
    }
  end
end
