defmodule CuraWeb.ConnCase do
  @moduledoc """
  This module defines the test case to be used by
  tests that require setting up a connection.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      @endpoint CuraWeb.Endpoint

      use CuraWeb, :verified_routes

      import Plug.Conn
      import Phoenix.ConnTest
      import CuraWeb.ConnCase
    end
  end

  setup tags do
    Cura.DataCase.setup_sandbox(tags)
    {:ok, conn: Phoenix.ConnTest.build_conn()}
  end
end
